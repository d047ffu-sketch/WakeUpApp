// ホーム画面（Phase 2 改訂版）
// フロー：
//   1. アラーム時刻（15分刻み）と ON/OFF を設定する。
//   2. 設定した時刻になると「アラームを止める」ボタンが表示される。
//   3. 「アラームを止める」を押すと、アラームを止めつつマッチング待機状態になる。
//      （= 以前の「マッチング開始」ボタンの役割をここに統合した）
//   4. 待機中は画面下半分の中央にキャンセルボタンを表示する。
//
// アラーム時刻には expo-notifications で「予約ローカル通知」を出す（Phase 5）。
// 設定の ON/OFF・時刻変更に合わせて、予約通知を入れ直す/取り消す。

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
  Alert,
  Platform,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { db } from '../../firebase';
import { useAuth } from '../../lib/auth-context';
import { joinMatchingPool, markAwake, tryMatch } from '../../lib/matching';
import {
  cancelAlarm,
  scheduleDailyAlarm,
  scheduleTestNotification,
  setupNotifications,
  showWakeNotification,
} from '../../lib/notifications';

// AsyncStorage に保存するときのキー名。
const STORAGE_KEY_TIME = '@wakeupapp:alarmTime'; // "7:15" のような "時:分" 文字列
const STORAGE_KEY_ENABLED = '@wakeupapp:alarmEnabled'; // "true" / "false"

export default function HomeScreen() {
  const { user } = useAuth();
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

  // アラームが鳴っているか。
  const [ringing, setRinging] = useState(false);
  // 事前マッチ済みの部屋ID（相手が決まっている）。null ならまだ相手なし。
  const [matchRoomId, setMatchRoomId] = useState<string | null>(null);

  // 同じ時刻で何度も鳴らさないための「処理済み」記録（例: "Sun Jun 15 2026 7:15"）。
  const handledKeyRef = useRef<string | null>(null);
  // この発生で待機列に登録済みか（1時間前の窓で1回だけ登録するため）。
  const prematchKeyRef = useRef<string | null>(null);
  // 最後に相手探しを試みた時刻（数秒ごとに再試行するため）。
  const lastTryMatchRef = useRef<number>(0);
  // 受け取った最後の「起きて！」の時刻（同じ合図で二重通知しないため）。
  const lastWakePingRef = useRef<number>(0);

  // アラームの予約通知を、現在の設定（ON/OFF・時刻）に合わせてセットし直す。
  const applyAlarmSchedule = useCallback(async (enabled: boolean, date: Date) => {
    if (enabled) {
      await scheduleDailyAlarm(date.getHours(), date.getMinutes());
    } else {
      await cancelAlarm();
    }
  }, []);

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
      loaded = roundToQuarter(loaded); // 念のため15分刻みに丸める
      setAlarmTime(loaded);

      const savedEnabled = await AsyncStorage.getItem(STORAGE_KEY_ENABLED);
      const enabled = savedEnabled === null ? true : savedEnabled === 'true';
      setAlarmEnabled(enabled);

      // 通知の許可を取り、保存済みの設定どおりに予約通知をセットする。
      await setupNotifications();
      await applyAlarmSchedule(enabled, loaded);
    })();
  }, [user, applyAlarmSchedule]);

  // 通知をタップしてアプリが開かれたら、鳴動状態（アラームを止める画面）にする。
  // 通知は web では使えないので、スマホのときだけ監視する。
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const sub = Notifications.addNotificationResponseReceivedListener(() => {
      setRinging(true);
    });
    return () => sub.remove();
  }, []);

  // 1秒ごとに時刻をチェックし、①1時間前になったら事前マッチ ②アラーム時刻になったら鳴動。
  useEffect(() => {
    if (!user) return;
    const id = setInterval(() => {
      if (!alarmEnabled) return;
      const now = new Date();

      // 今日のアラーム時刻（時:分）までの残り分数を計算する。
      const alarmToday = new Date();
      alarmToday.setHours(alarmTime.getHours(), alarmTime.getMinutes(), 0, 0);
      const minutesUntil = (alarmToday.getTime() - now.getTime()) / 60000;

      // この「日付＋時刻」の発生を一意に表すキー。
      const key = `${now.toDateString()} ${alarmTime.getHours()}:${alarmTime.getMinutes()}`;

      // ① アラームの1時間前〜アラーム時刻の間、まだマッチしていなければ：
      //    ・初回だけ待機列に登録する
      //    ・その後は成立するまで数秒ごとに相手探しを再試行する
      //      （2端末がほぼ同時にマッチ窓へ入っても「すれ違い」で取りこぼさないため）
      if (minutesUntil > 0 && minutesUntil <= 60 && !matchRoomId) {
        const timeStr = formatTime(alarmTime);
        if (prematchKeyRef.current !== key) {
          prematchKeyRef.current = key;
          lastTryMatchRef.current = Date.now(); // 登録直後は少し待ってから探し始める
          joinMatchingPool(user.uid, timeStr).catch((e) => console.warn('待機登録失敗', e));
        }
        // 2.5秒ごとに相手を探す。相手が待機列に来ていれば成立する。
        if (Date.now() - lastTryMatchRef.current >= 2500) {
          lastTryMatchRef.current = Date.now();
          tryMatch(user.uid, timeStr).catch((e) => console.warn('マッチ試行失敗', e));
        }
      }

      // ② アラーム時刻になったら鳴動状態にする（この発生でまだ鳴らしていなければ）。
      const sameTime =
        now.getHours() === alarmTime.getHours() &&
        now.getMinutes() === alarmTime.getMinutes();
      if (sameTime && handledKeyRef.current !== key) {
        handledKeyRef.current = key;
        setRinging(true);
      }
    }, 1000);
    return () => clearInterval(id);
  }, [alarmEnabled, alarmTime, matchRoomId, user]);

  // 1分ごとにあいさつを今の時間帯に合わせ直す（アプリを開きっぱなしでも切り替わるように）。
  // 値が変わらないときは React が再描画を省くので無駄な処理にはならない。
  useEffect(() => {
    const id = setInterval(() => setGreeting(getGreeting()), 60 * 1000);
    return () => clearInterval(id);
  }, []);

  // 自分の users を常に監視し、事前マッチが成立したら matchRoomId を得る。
  useEffect(() => {
    if (!user) return;
    const unsubscribe = onSnapshot(doc(db, 'users', user.uid), (snap) => {
      const roomId = snap.data()?.currentRoomId;
      setMatchRoomId(roomId ? roomId : null);
    });
    return () => unsubscribe();
  }, [user]);

  // マッチ済みの部屋を監視し、「起きて！」の合図が自分宛てに来たら通知を鳴らす。
  useEffect(() => {
    if (!user || !matchRoomId) return;
    const unsubscribe = onSnapshot(doc(db, 'rooms', matchRoomId), (snap) => {
      if (!snap.exists()) return;
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

  // 時刻が選ばれたときの共通処理。15分刻みに丸めて保存する。
  const onChangeTime = (event: DateTimePickerEvent, selectedDate?: Date) => {
    // 「決定」されたときだけ反映（×やキャンセルのときは event.type が 'dismissed'）。
    if (event.type === 'set' && selectedDate) {
      const rounded = roundToQuarter(selectedDate);
      setAlarmTime(rounded);
      AsyncStorage.setItem(STORAGE_KEY_TIME, `${rounded.getHours()}:${rounded.getMinutes()}`);
      applyAlarmSchedule(alarmEnabled, rounded); // 新しい時刻で予約通知を入れ直す
    }
  };

  // 「時刻を変更」を押したとき。
  const openPicker = () => {
    if (Platform.OS === 'android') {
      // Android は命令的にダイアログを開くのが推奨。minuteInterval が効かない端末向けに
      // onChange 側でも15分に丸めている。
      DateTimePickerAndroid.open({
        value: alarmTime,
        onChange: onChangeTime,
        mode: 'time',
        is24Hour: true,
        minuteInterval: 15,
      });
    } else {
      setShowPicker(true); // iOS は画面内にピッカーを表示
    }
  };

  // アラーム ON/OFF を切り替えたとき。
  const toggleEnabled = (value: boolean) => {
    setAlarmEnabled(value);
    AsyncStorage.setItem(STORAGE_KEY_ENABLED, value ? 'true' : 'false');
    applyAlarmSchedule(value, alarmTime); // ONなら予約、OFFなら取り消し
  };

  // 「アラームを止める」を押したとき。
  // 自分の起床を記録し、トーク待機画面へ移動する（相手も起きたらトークルームへ）。
  const handleStopAlarm = async () => {
    setRinging(false);
    if (!user) return;
    if (!matchRoomId) {
      // 事前マッチしていない場合はアラームを止めるだけ。
      Alert.alert('おはようございます', '今回はトーク相手が見つかりませんでした。');
      return;
    }
    try {
      await markAwake(user.uid, matchRoomId);
      router.push({ pathname: '/talk-waiting/[roomId]', params: { roomId: matchRoomId } });
    } catch (e) {
      console.warn('起床の記録に失敗', e);
      Alert.alert('エラー', '通信環境を確認してください。');
    }
  };

  // テスト用：実際の時刻を待たずに、すぐ鳴動状態にする。
  const testRing = () => {
    setRinging(true);
  };

  // テスト用：1時間前を待たずに、今すぐ事前マッチを試す（同じアラーム時刻の相手と）。
  const testPrematch = async () => {
    if (!user) return;
    const timeStr = formatTime(alarmTime);
    try {
      await joinMatchingPool(user.uid, timeStr);
      await tryMatch(user.uid, timeStr);
      Alert.alert(
        'マッチングを試しました',
        `${timeStr} に設定した相手を探します。相手も同じ時刻で試すとマッチします。`,
      );
    } catch (e) {
      console.warn('テストマッチ失敗', e);
      Alert.alert('エラー', '通信環境を確認してください。');
    }
  };

  // 時刻を15分ずつ増減する（web でも確実に変更できる。ネイティブのピッカーが使えない場合の代替）。
  const adjustAlarm = (deltaMinutes: number) => {
    const d = new Date(alarmTime);
    d.setMinutes(d.getMinutes() + deltaMinutes);
    const rounded = roundToQuarter(d); // 15分刻みに保つ
    setAlarmTime(rounded);
    AsyncStorage.setItem(STORAGE_KEY_TIME, `${rounded.getHours()}:${rounded.getMinutes()}`);
    applyAlarmSchedule(alarmEnabled, rounded); // 予約通知も入れ直す
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

  // ===== ホーム画面 =====
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.inner}>
        {/* あいさつ */}
        <Text style={styles.greeting}>{greeting}、{nickname || 'あなた'} さん</Text>

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

          {/* 時刻の変更：−15分／＋15分（どの端末でも動く）。ネイティブはピッカーも使える。 */}
          <View style={styles.timeControls}>
            <TouchableOpacity style={styles.adjustButton} onPress={() => adjustAlarm(-15)}>
              <Text style={styles.adjustButtonText}>−15分</Text>
            </TouchableOpacity>
            {Platform.OS !== 'web' && (
              <TouchableOpacity style={styles.changeButton} onPress={openPicker}>
                <Text style={styles.changeButtonText}>時刻を選ぶ</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.adjustButton} onPress={() => adjustAlarm(15)}>
              <Text style={styles.adjustButtonText}>＋15分</Text>
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
                minuteInterval={15}
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
            // アラーム鳴動中
            <View style={styles.ringingBox}>
              <Text style={styles.ringingTitle}>⏰ 起きる時間です！</Text>
              <Text style={styles.hint}>
                {matchRoomId
                  ? 'アラームを止めると、トーク相手を待つ画面に進みます。'
                  : '今回はトーク相手がいません。'}
              </Text>
              <TouchableOpacity style={styles.stopButton} onPress={handleStopAlarm}>
                <Text style={styles.stopButtonText}>アラームを止める</Text>
              </TouchableOpacity>
            </View>
          ) : matchRoomId ? (
            // 事前マッチ済み（アラームを待つ）
            <View style={styles.ringingBox}>
              <Text style={styles.matchedTitle}>🎉 マッチ成立！</Text>
              <Text style={styles.hint}>
                {formatTime(alarmTime)} のアラームで起きて、トークしましょう。
              </Text>
              {/* テスト用：アラーム時刻を待たずに、手動で鳴らす */}
              <TouchableOpacity onPress={testRing} style={styles.testLink}>
                <Text style={styles.testLinkText}>（テスト）今すぐ鳴らす</Text>
              </TouchableOpacity>
            </View>
          ) : (
            // 通常
            <>
              <Text style={styles.hint}>
                {alarmEnabled
                  ? 'アラームの1時間前になると、同じ時刻に起きる相手と自動でマッチします。'
                  : 'アラームはオフになっています。'}
              </Text>
              {/* テスト用リンク（不要なら削除可） */}
              <TouchableOpacity onPress={testPrematch} style={styles.testLink}>
                <Text style={styles.testLinkText}>（テスト）今すぐマッチング相手を探す</Text>
              </TouchableOpacity>
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

// 分を一番近い15分（0/15/30/45）に丸める。60分になったら次の時に繰り上げる。
function roundToQuarter(date: Date): Date {
  const d = new Date(date);
  let rounded = Math.round(d.getMinutes() / 15) * 15;
  if (rounded === 60) {
    d.setHours(d.getHours() + 1);
    rounded = 0;
  }
  d.setMinutes(rounded, 0, 0);
  return d;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f2f4f5',
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
    marginBottom: 24,
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
  // マッチング待機画面
  matchingContainer: {
    flex: 1,
  },
  matchingTop: {
    flex: 1, // 上半分
    justifyContent: 'center',
    alignItems: 'center',
  },
  matchingBottom: {
    flex: 1, // 下半分
    justifyContent: 'center',
    alignItems: 'center',
  },
  waitingText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1D3D47',
    marginTop: 16,
  },
  waitingSub: {
    fontSize: 13,
    color: '#777',
    marginTop: 4,
  },
  cancelButton: {
    paddingVertical: 12,
    paddingHorizontal: 40,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#999',
  },
  cancelButtonText: {
    color: '#555',
    fontSize: 16,
    fontWeight: '600',
  },
});
