// ホーム画面
// フロー：
//   1. アラーム時刻（30分刻み）を選ぶ。その時刻に何人待機しているかが見える。
//   2. アラームを ON にした瞬間に「マッチング待機」開始。相手がいればその場でマッチ成立。
//      （＝寝る前に ON にすれば、寝る前に相手が決まる＝約束を抱えて眠れる）
//   3. マッチ成立すると「◯◯さんと ◯回目」を表示する。
//   4. アラーム時刻に鳴動 →「アラームを止める」→ トーク待機画面へ。
//   5. アラーム時刻の30分後に自動で OFF になり、マッチも解除される（毎晩 ON にし直す運用）。
//
// アラーム時刻には expo-notifications で「予約ローカル通知」を出す。

import AsyncStorage from '@react-native-async-storage/async-storage';
import DateTimePicker, {
  DateTimePickerAndroid,
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { doc, getDoc, onSnapshot } from 'firebase/firestore';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { db } from '../../firebase';
import { useAuth } from '../../lib/auth-context';
import { useBackgroundColor } from '../../lib/background-color-context';
import {
  cancelMatch,
  joinMatchingPool,
  markAwake,
  removeFromPool,
  sendWakeMessage,
  subscribeWaitingCounts,
  tryMatch,
} from '../../lib/matching';
import {
  cancelAlarm,
  scheduleDailyAlarm,
  scheduleTestNotification,
  setupNotifications,
  showWakeNotification,
} from '../../lib/notifications';
import { recordNoShow, recordWoke, toMonthKey } from '../../lib/wake-log';

// AsyncStorage に保存するときのキー名。
const STORAGE_KEY_TIME = '@wakeupapp:alarmTime'; // "7:30" のような "時:分" 文字列
const STORAGE_KEY_ENABLED = '@wakeupapp:alarmEnabled'; // "true" / "false"
const STORAGE_KEY_AUTO_OFF_AT = '@wakeupapp:alarmAutoOffAt'; // 自動OFFする時刻（ミリ秒）

// アラーム時刻の何分後に自動でOFFにするか。
const AUTO_OFF_AFTER_MS = 30 * 60 * 1000;

type Status = 'idle' | 'ringing' | 'matching';

export default function HomeScreen() {
  const { user } = useAuth();
  const { backgroundColor } = useBackgroundColor();
  const router = useRouter();
  const [nickname, setNickname] = useState('');
  // 時間帯に応じたあいさつ（おはよう / こんにちは / こんばんは）。
  const [greeting, setGreeting] = useState(getGreeting);

  // アラーム時刻は Date 型で持つ（時:分だけ使う）。初期値は朝7:00。
  const [alarmTime, setAlarmTime] = useState<Date>(() => {
    const d = new Date();
    d.setHours(7, 0, 0, 0);
    return d;
  });
  const [alarmEnabled, setAlarmEnabled] = useState(true);
  const [showPicker, setShowPicker] = useState(false); // iOS で時刻ピッカーを表示中か
  const [status, setStatus] = useState<Status>('idle');

  // アラームが鳴っているか。
  const [ringing, setRinging] = useState(false);
  // マッチ済みの部屋ID（相手が決まっている）。null ならまだ相手なし。
  const [matchRoomId, setMatchRoomId] = useState<string | null>(null);
  // 自動でOFFにする時刻（ミリ秒）。ONにした時に「次のアラーム時刻＋30分」で決まる。
  const [autoOffAt, setAutoOffAt] = useState<number | null>(null);
  // アラーム時刻ごとの待機者数（自分は含まない）。例: { "7:00": 3 }
  const [waitingCounts, setWaitingCounts] = useState<Record<string, number>>({});
  // 相手ごとに「実際に話せた回数」。例: { 相手uid: 2 }
  const [metCount, setMetCount] = useState<Record<string, number>>({});
  // マッチ中の相手。
  const [partnerId, setPartnerId] = useState('');
  const [partnerName, setPartnerName] = useState('');
  // 相手の「今月のすっぽかし回数」（信頼の可視化）。
  const [partnerNoShow, setPartnerNoShow] = useState(0);
  // 起きた合図として相手に送る「朝の一言」。送信＝アラームを止めたことになる。
  const [wakeMessage, setWakeMessage] = useState('');
  const [sendingWake, setSendingWake] = useState(false);
  // 相手から届いている「朝の一言」（相手が先に起きた場合）。
  const [partnerWakeMessage, setPartnerWakeMessage] = useState('');

  // 自動OFFの処理が二重に走らないようにする目印。
  const autoOffRunningRef = useRef(false);

  // 同じ時刻で何度も鳴らさないための「処理済み」記録（例: "Sun Jun 15 2026 7:30"）。
  const handledKeyRef = useRef<string | null>(null);
  // 今のON状態で待機列に登録済みか。
  const joinedRef = useRef(false);
  // 最後に相手探しを試みた時刻（数秒ごとに再試行するため）。
  const lastTryMatchRef = useRef<number>(0);
  // 受け取った最後の「起きて！」の時刻（同じ合図で二重通知しないため）。
  const lastWakePingRef = useRef<number>(0);
  // 会った回数の最新値。マッチの抽選に渡す（state だと更新のたびに
  // 1秒ごとの処理が作り直されてしまうので、ref で持つ）。
  const metCountRef = useRef<Record<string, number>>({});

  // 今マッチしている相手とは「何回目」か（＝過去に話せた回数 ＋ 今回）。
  const meetingNumber = (metCount[partnerId] ?? 0) + 1;
  // 選んでいる時刻に、いま何人が待っているか。
  const waitingHere = waitingCounts[formatTime(alarmTime)] ?? 0;

  // アラームをONにする：予約通知をセットし、自動OFF時刻を決め、待機列に入って相手を探す。
  const turnAlarmOn = useCallback(
    async (date: Date) => {
      setAlarmEnabled(true);
      AsyncStorage.setItem(STORAGE_KEY_ENABLED, 'true');

      // 「ONにした時点より後にくる最初のアラーム時刻 ＋30分」を自動OFF時刻にする。
      const off = computeAutoOffAt(date, Date.now());
      setAutoOffAt(off);
      AsyncStorage.setItem(STORAGE_KEY_AUTO_OFF_AT, String(off));

      await scheduleDailyAlarm(date.getHours(), date.getMinutes());

      // ONと同時に待機開始。相手がすでに待っていればここで即マッチ成立する。
      if (!user) return;
      const timeStr = formatTime(date);
      joinedRef.current = true;
      lastTryMatchRef.current = Date.now();
      await joinMatchingPool(user.uid, timeStr).catch((e) => console.warn('待機登録失敗', e));
      // 会ったことがある人ほど当たりやすい抽選で相手を選ぶ。
      await tryMatch(user.uid, timeStr, metCountRef.current).catch((e) =>
        console.warn('マッチ試行失敗', e),
      );
    },
    [user],
  );

  // アラームをOFFにする（手動 / 自動OFF 共通）。待機列から外し、マッチも解除する。
  const turnAlarmOff = useCallback(
    async (roomId: string | null) => {
      setAlarmEnabled(false);
      setAutoOffAt(null);
      AsyncStorage.setItem(STORAGE_KEY_ENABLED, 'false');
      AsyncStorage.removeItem(STORAGE_KEY_AUTO_OFF_AT);
      joinedRef.current = false;
      await cancelAlarm();
      if (!user) return;
      await removeFromPool(user.uid).catch(() => { });
      if (roomId) await cancelMatch(user.uid, roomId).catch(() => { });
    },
    [user],
  );

  // アラーム時刻＋30分になったときの処理。
  // マッチしていたのに起きていなければ「すっぽかし」として記録してから OFF にする。
  const handleAutoOff = useCallback(
    async (roomId: string | null) => {
      if (autoOffRunningRef.current) return;
      autoOffRunningRef.current = true;
      try {
        if (roomId && user) {
          // 部屋の最新状態を読み、自分が起きていたかを確かめる
          // （画面の状態より、サーバーの記録を信じる）。
          const snap = await getDoc(doc(db, 'rooms', roomId));
          const data = snap.data();
          const iWokeUp = data?.awake?.[user.uid] === true;
          if (!iWokeUp) {
            const participants: string[] = data?.participants ?? [];
            const pid = participants.find((id) => id !== user.uid) ?? '';
            const name = (data?.names ?? {})[pid] ?? '相手';
            await recordNoShow(user.uid, name, formatTime(alarmTime)).catch(() => { });
          }
        }
      } catch (e) {
        console.warn('すっぽかし記録に失敗', e);
      }
      await turnAlarmOff(roomId);
      autoOffRunningRef.current = false;
    },
    [user, alarmTime, turnAlarmOff],
  );

  // 相手の「今月のすっぽかし回数」を購読する（マッチ中だけ）。
  useEffect(() => {
    if (!partnerId) {
      setPartnerNoShow(0);
      return;
    }
    const monthKey = toMonthKey(new Date());
    return onSnapshot(doc(db, 'users', partnerId), (snap) => {
      setPartnerNoShow(snap.data()?.noShow?.[monthKey] ?? 0);
    });
  }, [partnerId]);

  // 画面表示時に、ニックネームと保存済みのアラーム設定を読み込む。
  useEffect(() => {
    if (!user) return;
    (async () => {
      const snap = await getDoc(doc(db, 'users', user.uid));
      if (snap.exists()) setNickname(snap.data().nickname ?? '');

      // 保存済みのアラーム時刻（無ければ初期値の7:00）。
      let loaded = new Date();
      loaded.setHours(7, 0, 0, 0);
      const savedTime = await AsyncStorage.getItem(STORAGE_KEY_TIME);
      if (savedTime) {
        const [h, m] = savedTime.split(':').map(Number);
        loaded = new Date();
        loaded.setHours(h, m, 0, 0);
      }
      loaded = roundToHalfHour(loaded); // 念のため30分刻みに丸める
      setAlarmTime(loaded);

      const savedEnabled = await AsyncStorage.getItem(STORAGE_KEY_ENABLED);
      const enabled = savedEnabled === 'true'; // 既定はOFF（毎晩ONにし直す運用）
      setAlarmEnabled(enabled);

      const savedOff = await AsyncStorage.getItem(STORAGE_KEY_AUTO_OFF_AT);
      setAutoOffAt(savedOff ? Number(savedOff) : null);

      // 通知の許可を取り、保存済みの設定どおりに予約通知をセットする。
      await setupNotifications();
      if (enabled) {
        await scheduleDailyAlarm(loaded.getHours(), loaded.getMinutes());
      } else {
        await cancelAlarm();
      }
    })();
  }, [user]);

  // 通知をタップしてアプリが開かれたら、鳴動状態（アラームを止める画面）にする。
  // 通知は web では使えないので、スマホのときだけ監視する。
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const sub = Notifications.addNotificationResponseReceivedListener(() => {
      setRinging(true);
    });
    return () => sub.remove();
  }, []);

  // 1秒ごとに：①自動OFF ②アラーム時刻になったら鳴動 ③ON中は成立するまで相手を探し続ける。
  useEffect(() => {
    if (!user) return;
    const id = setInterval(() => {
      const now = new Date();

      // ① アラーム時刻＋30分を過ぎたら自動でOFF（起きていなければ すっぽかし を記録）。
      if (alarmEnabled && autoOffAt && now.getTime() >= autoOffAt) {
        void handleAutoOff(matchRoomId);
        return;
      }
      if (!alarmEnabled) return;

      // この「日付＋時刻」の発生を一意に表すキー。
      const key = `${now.toDateString()} ${alarmTime.getHours()}:${alarmTime.getMinutes()}`;

      // ② アラーム時刻になったら鳴動状態にする（この発生でまだ鳴らしていなければ）。
      const sameTime =
        now.getHours() === alarmTime.getHours() &&
        now.getMinutes() === alarmTime.getMinutes();
      if (sameTime && handledKeyRef.current !== key) {
        handledKeyRef.current = key;
        setRinging(true);
      }

      // ③ まだ鳴っておらず・未マッチなら、待機列に居続けて相手を探す。
      //    （鳴った後に再マッチしないよう、鳴動済みの回は探さない）
      const alreadyRang = handledKeyRef.current === key;
      if (!matchRoomId && !alreadyRang) {
        const timeStr = formatTime(alarmTime);
        if (!joinedRef.current) {
          // 何らかの理由で待機列から外れていたら入り直す。
          joinedRef.current = true;
          lastTryMatchRef.current = Date.now();
          void joinMatchingPool(user.uid, timeStr).catch((e) => console.warn('待機登録失敗', e));
        } else if (Date.now() - lastTryMatchRef.current >= 2500) {
          // 2.5秒ごとに相手を探す。相手が待機列に来ていれば成立する。
          lastTryMatchRef.current = Date.now();
          void tryMatch(user.uid, timeStr, metCountRef.current).catch((e) =>
            console.warn('マッチ試行失敗', e),
          );
        }
      }
    }, 1000);
    return () => clearInterval(id);
  }, [alarmEnabled, alarmTime, matchRoomId, user, autoOffAt, handleAutoOff]);

  // 1分ごとにあいさつを今の時間帯に合わせ直す（アプリを開きっぱなしでも切り替わるように）。
  // 値が変わらないときは React が再描画を省くので無駄な処理にはならない。
  useEffect(() => {
    const id = setInterval(() => setGreeting(getGreeting()), 60 * 1000);
    return () => clearInterval(id);
  }, []);

  // 待機列を監視して、時刻ごとの待機者数を取得する（人がいる時刻を探せるように）。
  useEffect(() => {
    if (!user) return;
    return subscribeWaitingCounts(user.uid, setWaitingCounts);
  }, [user]);

  // 自分の users を常に監視し、マッチが成立したら matchRoomId を、
  // 「実際に話せた回数」（metCount）も受け取る。
  useEffect(() => {
    if (!user) return;
    const unsubscribe = onSnapshot(doc(db, 'users', user.uid), (snap) => {
      const data = snap.data();
      const roomId = data?.currentRoomId;
      setMatchRoomId(roomId ? roomId : null);
      const counts = data?.metCount ?? {};
      setMetCount(counts);
      metCountRef.current = counts; // 抽選で使う最新値

      // マッチが成立した＝待機列からは外れているので、登録済みフラグを下ろす。
      if (roomId) joinedRef.current = false;
    });
    return () => unsubscribe();
  }, [user]);

  // マッチ済みの部屋を監視し、相手の名前を取得しつつ、
  // 「起きて！」の合図が自分宛てに来たら通知を鳴らす。
  useEffect(() => {
    if (!user || !matchRoomId) {
      setPartnerId('');
      setPartnerName('');
      return;
    }
    const unsubscribe = onSnapshot(doc(db, 'rooms', matchRoomId), (snap) => {
      if (!snap.exists()) return;

      // 相手のIDと名前。
      const participants: string[] = snap.data().participants ?? [];
      const pid = participants.find((id) => id !== user.uid) ?? '';
      setPartnerId(pid);
      setPartnerName((snap.data().names ?? {})[pid] || '相手');

      // 相手が先に起きて送ってきた「朝の一言」。
      setPartnerWakeMessage((snap.data().wakeMessages ?? {})[pid] ?? '');

      const ping = snap.data().wakePing;
      // 自分宛て かつ 新しい合図（2分以内）だけ通知する。
      if (
        ping &&
        ping.to === user.uid &&
        ping.at > lastWakePingRef.current &&
        Date.now() - ping.at < 120000
      ) {
        lastWakePingRef.current = ping.at;
        setRinging(true); // 起こすために鳴動状態にする
        showWakeNotification(); // 端末に通知を出す
        Alert.alert('起きて！', '早く起きてください。トーク相手はすでに起きています。');
      }
    });
    return () => unsubscribe();
  }, [user, matchRoomId]);

  // 時刻を変更したときの共通処理（ピッカー・±30分ボタンの両方から呼ぶ）。
  const applyTimeChange = async (next: Date) => {
    const rounded = roundToHalfHour(next); // 30分刻みに保つ
    setAlarmTime(rounded);
    AsyncStorage.setItem(STORAGE_KEY_TIME, `${rounded.getHours()}:${rounded.getMinutes()}`);

    if (!alarmEnabled) return; // OFF中は時刻を覚えるだけ

    // ON のまま時刻を変えた場合：予約を入れ直し、自動OFF時刻も計算し直す。
    await scheduleDailyAlarm(rounded.getHours(), rounded.getMinutes());
    const off = computeAutoOffAt(rounded, Date.now());
    setAutoOffAt(off);
    AsyncStorage.setItem(STORAGE_KEY_AUTO_OFF_AT, String(off));

    if (!user) return;
    // 時刻が変わると相手の条件も変わるので、マッチ済みなら解除して新しい時刻で入り直す。
    if (matchRoomId) await cancelMatch(user.uid, matchRoomId).catch(() => { });
    joinedRef.current = false; // 新しい時刻で待機列に入り直す（1秒ごとの処理が拾う）
  };

  // ピッカーで時刻が選ばれたとき。
  const onChangeTime = (event: DateTimePickerEvent, selectedDate?: Date) => {
    // 「決定」されたときだけ反映（×やキャンセルのときは event.type が 'dismissed'）。
    if (event.type === 'set' && selectedDate) {
      void applyTimeChange(selectedDate);
    }
  };

  // 「時刻を選ぶ」を押したとき。
  const openPicker = () => {
    if (Platform.OS === 'android') {
      // Android は命令的にダイアログを開くのが推奨。minuteInterval が効かない端末向けに
      // onChange 側でも30分に丸めている。
      DateTimePickerAndroid.open({
        value: alarmTime,
        onChange: onChangeTime,
        mode: 'time',
        is24Hour: true,
        minuteInterval: 30,
      });
    } else {
      setShowPicker(true); // iOS は画面内にピッカーを表示
    }
  };

  // アラーム ON/OFF を切り替えたとき。ON＝その場で待機開始、OFF＝待機解除。
  const toggleEnabled = (value: boolean) => {
    if (value) {
      void turnAlarmOn(alarmTime);
    } else {
      void turnAlarmOff(matchRoomId);
    }
  };

  // 「アラームを止める」を押したとき。
  // 自分の起床を記録し、トーク待機画面へ移動する（相手も起きたらトークルームへ）。
  // マッチ相手がいない場合だけ使う「アラームを止める」。
  const handleStopAlarm = async () => {
    setRinging(false);
    if (!user) return;
    // アラームを止めた＝起きた、としてカレンダーに記録する。
    await recordWoke(user.uid, '', formatTime(alarmTime)).catch((e) =>
      console.warn('起床記録に失敗', e),
    );
    Alert.alert('おはようございます', '今回はトーク相手が見つかりませんでした。');
  };

  const cancelMatching = async () => {
    setStatus('idle');
    await turnAlarmOff(matchRoomId);
  };

  // 相手に「朝の一言」を送る＝アラームを止めたことになる。
  // 文章を打って送る必要があるので、寝ぼけたままでは止められない（起きた証明になる）。
  // 送信に成功して初めてアラームが止まり、トーク待機画面へ進む。
  const handleSendWakeMessage = async () => {
    const text = wakeMessage.trim();
    if (!text || !user || !matchRoomId || sendingWake) return;

    setSendingWake(true);
    try {
      // ① 相手に届ける（トークルームの1言目にもなる）
      await sendWakeMessage(matchRoomId, user.uid, text);
      // ② カレンダーに「起きた」を記録
      await recordWoke(user.uid, partnerName, formatTime(alarmTime)).catch((e) =>
        console.warn('起床記録に失敗', e),
      );
      // ③ 起床フラグを立てる（2人揃えばトークルームが始まる）
      await markAwake(user.uid, matchRoomId);

      // ここまで成功して初めてアラームを止める。
      setRinging(false);
      setWakeMessage('');
      router.push({ pathname: '/talk-waiting/[roomId]', params: { roomId: matchRoomId } });
    } catch (e) {
      console.warn('一言の送信に失敗', e);
      Alert.alert('送信できませんでした', '通信環境を確認して、もう一度お試しください。');
    } finally {
      setSendingWake(false);
    }
  };

  // テスト用：実際の時刻を待たずに、すぐ鳴動状態にする。
  const testRing = () => {
    setRinging(true);
  };

  // 時刻を30分ずつ増減する（web でも確実に変更できる。ネイティブのピッカーが使えない場合の代替）。
  const adjustAlarm = (deltaMinutes: number) => {
    const d = new Date(alarmTime);
    d.setMinutes(d.getMinutes() + deltaMinutes);
    void applyTimeChange(d);
  };

  // テスト用：5秒後に本物の通知を出す（通知が実際に届くか確認するため）。
  const handleTestNotification = async () => {
    const granted = await setupNotifications();
    if (!granted) {
      Alert.alert('通知が許可されていません', '端末の設定でこのアプリの通知を許可してください。');
      return;
    }
    await scheduleTestNotification(5);
    Alert.alert(
      'テスト通知を予約しました',
      '5秒後に通知が届きます。アプリをホーム画面に戻して待ってみてください。',
    );
  };

  // ===== マッチング待機画面（下半分の中央にキャンセルボタン） =====
  if (status === 'matching') {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor }]}>
        <View style={styles.matchingContainer}>
          {/* 上半分：くるくる＋案内（中央寄せ） */}
          <View style={styles.matchingTop}>
            <ActivityIndicator size="large" color="#1D3D47" />
            <Text style={styles.waitingText}>マッチング待機中...</Text>
            <Text style={styles.waitingSub}>同じ時間に起きた人を探しています</Text>
          </View>
          {/* 下半分：中央にキャンセルボタン */}
          <View style={styles.matchingBottom}>
            <TouchableOpacity style={styles.cancelButton} onPress={cancelMatching}>
              <Text style={styles.cancelButtonText}>キャンセル</Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // ===== 通常画面（idle / ringing） =====
  return (
    <SafeAreaView style={[styles.container, { backgroundColor }]}>
      {/* 一言を打つときにキーボードで入力欄が隠れないようにする */}
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.inner}>
          <View style={styles.headerRow}>
            <Text style={styles.greeting}>{greeting}、{nickname || 'あなた'} さん</Text>
            <TouchableOpacity style={styles.calendarButton} onPress={() => router.push('/calendar')}>
              <Text style={styles.calendarButtonText}>カレンダー</Text>
            </TouchableOpacity>
          </View>

          {/* アラーム設定カード */}
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>アラーム</Text>
              <Switch value={alarmEnabled} onValueChange={toggleEnabled} />
            </View>

            {/* 大きく時刻を表示 */}
            <Text style={[styles.time, !alarmEnabled && styles.timeDisabled]}>
              {formatTime(alarmTime)}
            </Text>

            {/* この時刻に何人待っているか（人がいる時刻を探せるように） */}
            <View style={[styles.waitingBadge, waitingHere > 0 && styles.waitingBadgeActive]}>
              <Text style={[styles.waitingText, waitingHere > 0 && styles.waitingTextActive]}>
                {waitingHere > 0
                  ? `この時刻に ${waitingHere}人 が待っています`
                  : 'この時刻に待っている人はいません'}
              </Text>
            </View>

            {/* 時刻の変更：−30分／＋30分（どの端末でも動く）。ネイティブはピッカーも使える。 */}
            <View style={styles.timeControls}>
              <TouchableOpacity style={styles.adjustButton} onPress={() => adjustAlarm(-30)}>
                <Text style={styles.adjustButtonText}>−30分</Text>
              </TouchableOpacity>
              {Platform.OS !== 'web' && (
                <TouchableOpacity style={styles.changeButton} onPress={openPicker}>
                  <Text style={styles.changeButtonText}>時刻を選ぶ</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={styles.adjustButton} onPress={() => adjustAlarm(30)}>
                <Text style={styles.adjustButtonText}>＋30分</Text>
              </TouchableOpacity>
            </View>

            {/* iOS 用のインラインピッカー＋「完了」ボタン */}
            {showPicker && Platform.OS === 'ios' && (
              <View>
                <DateTimePicker
                  value={alarmTime}
                  mode="time"
                  is24Hour
                  display="spinner"
                  minuteInterval={30}
                  // 端末がダークモードでも、白いカード上で数字がちゃんと見えるように
                  // テーマと文字色を明示的に指定する（iOS 用の設定）。
                  themeVariant="light"
                  textColor="#1D3D47"
                  onChange={onChangeTime}
                />
                <TouchableOpacity style={styles.doneButton} onPress={() => setShowPicker(false)}>
                  <Text style={styles.doneButtonText}>完了</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>

          {/* 下部：鳴動中／マッチ済み／通常 で表示を切り替える */}
          <View style={styles.bottomSection}>
            {ringing ? (
              // アラーム鳴動中：相手がいれば「一言を送る」＝アラームを止める
              <View style={styles.ringingBox}>
                <Text style={styles.ringingTitle}>⏰ 起きる時間です！</Text>

                {matchRoomId ? (
                  <>
                    {/* 相手が先に起きて一言を送ってくれていたら見せる（起きる動機になる） */}
                    {partnerWakeMessage ? (
                      <View style={styles.partnerMessageBox}>
                        <Text style={styles.partnerMessageFrom}>
                          {partnerName || '相手'} さんから
                        </Text>
                        <Text style={styles.partnerMessageText}>{partnerWakeMessage}</Text>
                      </View>
                    ) : null}

                    <Text style={styles.hint}>
                      {partnerName || '相手'} さんに一言送ると、アラームが止まります。
                    </Text>

                    <TextInput
                      style={styles.wakeInput}
                      value={wakeMessage}
                      onChangeText={setWakeMessage}
                      placeholder="おはよう！今日もがんばろう"
                      placeholderTextColor="#9aa6ab"
                      maxLength={100}
                      multiline
                    />
                    <TouchableOpacity
                      style={[
                        styles.stopButton,
                        (!wakeMessage.trim() || sendingWake) && styles.stopButtonDisabled,
                      ]}
                      onPress={handleSendWakeMessage}
                      disabled={!wakeMessage.trim() || sendingWake}>
                      <Text style={styles.stopButtonText}>
                        {sendingWake ? '送信中…' : '送信してアラームを止める'}
                      </Text>
                    </TouchableOpacity>
                  </>
                ) : (
                  <>
                    <Text style={styles.hint}>今回はトーク相手がいません。</Text>
                    <TouchableOpacity style={styles.stopButton} onPress={handleStopAlarm}>
                      <Text style={styles.stopButtonText}>アラームを止める</Text>
                    </TouchableOpacity>
                  </>
                )}
              </View>
            ) : matchRoomId ? (
              // マッチ済み（アラームを待つ）：相手の名前と「◯回目」を見せる
              <View style={styles.ringingBox}>
                <Text style={styles.matchedTitle}>🎉 マッチ成立！</Text>
                <Text style={styles.partnerName}>{partnerName || '相手'} さん</Text>
                <View style={styles.badgeRow}>
                  <View style={styles.meetBadge}>
                    <Text style={styles.meetBadgeText}>
                      {meetingNumber === 1 ? 'はじめまして' : `${meetingNumber}回目`}
                    </Text>
                  </View>
                  {/* 信頼の可視化：相手の今月のすっぽかし回数 */}
                  <View style={[styles.noShowBadge, partnerNoShow > 0 && styles.noShowBadgeWarn]}>
                    <Text
                      style={[styles.noShowText, partnerNoShow > 0 && styles.noShowTextWarn]}>
                      今月のすっぽかし {partnerNoShow}回
                    </Text>
                  </View>
                </View>
                <Text style={styles.hint}>
                  {formatTime(alarmTime)} のアラームで起きて、トークしましょう。
                </Text>
                {/* テスト用：スマホは本物の通知を送る／web は画面内で鳴らす */}
                {Platform.OS === 'web' ? (
                  <TouchableOpacity onPress={testRing} style={styles.testLink}>
                    <Text style={styles.testLinkText}>（テスト）今すぐ鳴らす</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity onPress={handleTestNotification} style={styles.testLink}>
                    <Text style={styles.testLinkText}>（テスト）通知を送る</Text>
                  </TouchableOpacity>
                )}
              </View>
            ) : (
              // 通常
              <>
                <Text style={styles.hint}>
                  {alarmEnabled
                    ? '同じ時刻に起きる相手を探しています…'
                    : 'アラームをオンにすると、同じ時刻に起きる相手を探します。'}
                </Text>
                {/* テスト用リンク（不要なら削除可） */}
                <TouchableOpacity onPress={testRing} style={styles.testLink}>
                  <Text style={styles.testLinkText}>（テスト）今すぐ鳴らす</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={handleTestNotification} style={styles.testLink}>
                  <Text style={styles.testLinkText}>（テスト）5秒後に通知を送る</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// 今の時間帯に合ったあいさつを返す。
//   5:00〜10:59 → おはよう / 11:00〜17:59 → こんにちは / それ以外 → こんばんは
function getGreeting(): string {
  const h = new Date().getHours();
  if (h >= 5 && h < 11) return 'おはよう';
  if (h >= 11 && h < 18) return 'こんにちは';
  return 'こんばんは';
}

// Date から "7:15" のような時刻文字列を作る（分は2桁ゼロ埋め）。
function formatTime(date: Date): string {
  const h = date.getHours();
  const m = date.getMinutes().toString().padStart(2, '0');
  return `${h}:${m}`;
}

// 分を一番近い30分（0 or 30）に丸める。60分になったら次の時に繰り上げる。
// 刻みを大きくするほど同じ時刻に人が集まりやすく、マッチしやすくなる。
function roundToHalfHour(date: Date): Date {
  const d = new Date(date);
  let rounded = Math.round(d.getMinutes() / 30) * 30;
  if (rounded === 60) {
    d.setHours(d.getHours() + 1);
    rounded = 0;
  }
  d.setMinutes(rounded, 0, 0);
  return d;
}

// 「基準時刻より後にくる最初のアラーム時刻」＋30分 を返す（＝自動OFFする時刻）。
// 例）23:00にON・アラーム7:00 → 翌日7:30。8:00にON・アラーム7:00 → 翌日7:30（すぐOFFにならない）。
function computeAutoOffAt(alarm: Date, fromMs: number): number {
  const next = new Date(fromMs);
  next.setHours(alarm.getHours(), alarm.getMinutes(), 0, 0);
  if (next.getTime() <= fromMs) {
    next.setDate(next.getDate() + 1); // もう過ぎていれば翌日
  }
  return next.getTime() + AUTO_OFF_AFTER_MS;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: {
    flex: 1,
    backgroundColor: '#f2f4f5',
  },
  wakeInput: {
    width: '100%',
    minHeight: 52,
    maxHeight: 100,
    borderWidth: 1,
    borderColor: '#ccd4d7',
    borderRadius: 12,
    backgroundColor: '#fff',
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    marginTop: 12,
    marginBottom: 12,
    textAlignVertical: 'top',
  },
  stopButtonDisabled: {
    opacity: 0.4,
  },
  partnerMessageBox: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#e0e4e6',
    maxWidth: 320,
  },
  partnerMessageFrom: {
    fontSize: 12,
    color: '#888',
    marginBottom: 6,
  },
  partnerMessageText: {
    fontSize: 16,
    color: '#1D3D47',
    lineHeight: 24,
  },
  inner: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 16,
  },
  greeting: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#1D3D47',
    flexShrink: 1,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
  },
  time: {
    fontSize: 64,
    fontWeight: '200',
    textAlign: 'center',
    color: '#1D3D47',
    marginVertical: 8,
  },
  timeDisabled: {
    color: '#bbb',
  },
  waitingBadge: {
    alignSelf: 'center',
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: '#f0f2f3',
    marginBottom: 12,
  },
  waitingBadgeActive: {
    backgroundColor: '#e3f5e8',
  },
  waitingText: {
    fontSize: 13,
    color: '#8a969b',
  },
  waitingTextActive: {
    color: '#1e7a44',
    fontWeight: '700',
  },
  partnerName: {
    fontSize: 26,
    fontWeight: 'bold',
    color: '#1D3D47',
    marginBottom: 8,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  meetBadge: {
    paddingVertical: 6,
    paddingHorizontal: 18,
    borderRadius: 16,
    backgroundColor: '#1D3D47',
  },
  meetBadgeText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: 'bold',
  },
  noShowBadge: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 16,
    backgroundColor: '#e3f5e8',
  },
  noShowBadgeWarn: {
    backgroundColor: '#fdeaea',
  },
  noShowText: {
    color: '#1e7a44',
    fontSize: 13,
    fontWeight: '700',
  },
  noShowTextWarn: {
    color: '#c23b3b',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  calendarButton: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 18,
    backgroundColor: '#fff',
  },
  calendarButtonText: {
    color: '#1D3D47',
    fontSize: 13,
    fontWeight: '700',
  },
  timeControls: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  adjustButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    backgroundColor: '#eef2f3',
  },
  adjustButtonText: {
    color: '#1D3D47',
    fontSize: 15,
    fontWeight: '700',
  },
  changeButton: {
    alignSelf: 'center',
    paddingVertical: 8,
    paddingHorizontal: 20,
    borderRadius: 20,
    backgroundColor: '#dfe7e9',
  },
  changeButtonText: {
    color: '#1D3D47',
    fontSize: 14,
    fontWeight: '600',
  },
  doneButton: {
    alignSelf: 'center',
    marginTop: 8,
    paddingVertical: 8,
    paddingHorizontal: 24,
  },
  doneButtonText: {
    color: '#1D3D47',
    fontSize: 16,
    fontWeight: 'bold',
  },
  bottomSection: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  hint: {
    fontSize: 14,
    color: '#777',
    textAlign: 'center',
    lineHeight: 22,
  },
  testLink: {
    marginTop: 16,
    padding: 8,
  },
  testLinkText: {
    fontSize: 13,
    color: '#9aa6ab',
    textDecorationLine: 'underline',
  },
  ringingBox: {
    alignItems: 'center',
  },
  ringingTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#1D3D47',
    marginBottom: 24,
  },
  matchedTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#1D3D47',
    marginBottom: 12,
  },
  stopButton: {
    backgroundColor: '#1D3D47',
    borderRadius: 16,
    paddingVertical: 20,
    paddingHorizontal: 48,
    alignItems: 'center',
  },
  stopButtonText: {
    color: '#fff',
    fontSize: 22,
    fontWeight: 'bold',
  },
  matchingContainer: {
    flex: 1,
    justifyContent: 'space-between',
    padding: 24,
  },
  matchingTop: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  waitingSub: {
    fontSize: 14,
    color: '#8a969b',
    marginTop: 8,
    textAlign: 'center',
  },
  matchingBottom: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingBottom: 32,
  },
  cancelButton: {
    backgroundColor: '#1D3D47',
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 32,
  },
  cancelButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  // マッチング待機画面
});
