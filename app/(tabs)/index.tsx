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
  ActivityIndicator,
  Alert,
  Platform,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { TomorrowMessageCard } from '../../components/tomorrow-message-card';
import { TomorrowMessageView } from '../../components/tomorrow-message-view';
import { db } from '../../firebase';
import { useAuth } from '../../lib/auth-context';
import { joinMatchingPool, leaveMatchingPool, tryMatch } from '../../lib/matching';
import {
  cancelAlarm,
  scheduleDailyAlarm,
  scheduleTestNotification,
  setupNotifications,
} from '../../lib/notifications';

// AsyncStorage に保存するときのキー名。
const STORAGE_KEY_TIME = '@wakeupapp:alarmTime'; // "7:15" のような "時:分" 文字列
const STORAGE_KEY_ENABLED = '@wakeupapp:alarmEnabled'; // "true" / "false"

// 画面の状態：通常 / アラーム鳴動中 / マッチング待機中
type Status = 'idle' | 'ringing' | 'matching';

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
  const [status, setStatus] = useState<Status>('idle');

  // 同じ時刻で何度も鳴らさないための「処理済み」記録（例: "Sun Jun 15 2026 7:15"）。
  const handledKeyRef = useRef<string | null>(null);

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
      setStatus((prev) => (prev === 'matching' ? prev : 'ringing'));
    });
    return () => sub.remove();
  }, []);

  // 1秒ごとに「今がアラーム時刻か」をチェックし、時刻になったら鳴動状態にする。
  useEffect(() => {
    const id = setInterval(() => {
      if (!alarmEnabled) return;
      const now = new Date();
      const sameTime =
        now.getHours() === alarmTime.getHours() &&
        now.getMinutes() === alarmTime.getMinutes();
      if (!sameTime) return;

      // この「日付＋時刻」の発生を一意に表すキー（1分間に何度も鳴らさないため）。
      const key = `${now.toDateString()} ${alarmTime.getHours()}:${alarmTime.getMinutes()}`;
      setStatus((prev) => {
        // 通常状態のときだけ、かつこの発生をまだ処理していなければ鳴らす。
        if (prev === 'idle' && handledKeyRef.current !== key) {
          handledKeyRef.current = key;
          return 'ringing';
        }
        return prev;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [alarmEnabled, alarmTime]);

  // 1分ごとにあいさつを今の時間帯に合わせ直す（アプリを開きっぱなしでも切り替わるように）。
  // 値が変わらないときは React が再描画を省くので無駄な処理にはならない。
  useEffect(() => {
    const id = setInterval(() => setGreeting(getGreeting()), 60 * 1000);
    return () => clearInterval(id);
  }, []);

  // マッチング待機中だけ、自分の users を監視する。
  // 相手とペアが成立すると currentRoomId が入るので、それを検知してチャット画面へ遷移する。
  useEffect(() => {
    if (status !== 'matching' || !user) return;
    const unsubscribe = onSnapshot(doc(db, 'users', user.uid), (snap) => {
      const roomId = snap.data()?.currentRoomId;
      if (roomId) {
        setStatus('idle'); // 待機状態を解除
        // まずマッチング成功画面へ。その画面が3秒後にトーク画面へ移動する。
        router.push({ pathname: '/match/[roomId]', params: { roomId } });
      }
    });
    return () => unsubscribe();
  }, [status, user, router]);

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
  // アラームを止めて、そのままマッチング待機状態に入る（旧「マッチング開始」の機能）。
  const stopAlarmAndMatch = async () => {
    if (!user) return;
    try {
      // 先にプール登録（currentRoomId も空にリセット）してから待機UIへ。
      // こうすることで、待機監視を始めた瞬間に古い部屋IDで誤遷移するのを防ぐ。
      await joinMatchingPool(user.uid);
      setStatus('matching');
      // すでに待機中の相手がいればこの場でペア成立。いなければ待機を続ける
      // （相手が後から来たら、相手側の処理でこちらの currentRoomId が入る）。
      await tryMatch(user.uid);
    } catch (e) {
      console.warn('マッチング開始に失敗', e);
      Alert.alert('エラー', 'マッチングの開始に失敗しました。通信環境を確認してください。');
      setStatus('idle');
    }
  };

  // 待機キャンセル。待機UIを閉じ、プールから自分を外す。
  const cancelMatching = async () => {
    setStatus('idle');
    if (user) await leaveMatchingPool(user.uid);
  };

  // テスト用：実際の時刻を待たずに、すぐ鳴動状態にする（アプリ内の見た目だけ）。
  const testRing = () => {
    setStatus('ringing');
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
      <SafeAreaView style={styles.container}>
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

          <TouchableOpacity style={styles.changeButton} onPress={openPicker}>
            <Text style={styles.changeButtonText}>時刻を変更（15分刻み）</Text>
          </TouchableOpacity>

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

        {/* 明日の自分へのメッセージ（日時指定の下に配置）。鳴動中は停止画面側に表示する。 */}
        {status !== 'ringing' && <TomorrowMessageCard />}

        {/* 下部：鳴動中は「アラームを止める」、それ以外は案内文を表示 */}
        <View style={styles.bottomSection}>
          {status === 'ringing' ? (
            <View style={styles.ringingBox}>
              <Text style={styles.ringingTitle}>⏰ 起きる時間です！</Text>
              {/* 昨日の23時の自分からのメッセージ（あれば表示） */}
              <TomorrowMessageView />
              <TouchableOpacity style={styles.stopButton} onPress={stopAlarmAndMatch}>
                <Text style={styles.stopButtonText}>アラームを止める</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <Text style={styles.hint}>
                {alarmEnabled
                  ? 'アラーム時刻になると、ここに「アラームを止める」ボタンが表示されます。'
                  : 'アラームはオフになっています。'}
              </Text>
              {/* テスト用リンク（不要なら削除可） */}
              <TouchableOpacity onPress={testRing} style={styles.testLink}>
                <Text style={styles.testLinkText}>（テスト）今すぐ鳴らす（画面のみ）</Text>
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
  changeButton: {
    alignSelf: 'center',
    paddingVertical: 8,
    paddingHorizontal: 20,
    borderRadius: 20,
    backgroundColor: '#eef2f3',
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
