// 「明日の自分へのメッセージ」の保存・読み込みロジック。
// 寝る前に自分あてのメッセージを書いておき、翌朝のアラーム通知や
// アラーム停止画面に表示する。アラーム時刻の30分後に自動で空になる。

import AsyncStorage from '@react-native-async-storage/async-storage';

// このメッセージ用の保存キー。
const KEY_TEXT = '@wakeupapp:tomorrowMessage'; // メッセージ本文
const KEY_EXPIRES = '@wakeupapp:tomorrowMessageExpiresAt'; // リセット時刻（ミリ秒）

// アラーム設定はホーム画面が保存しているキーをそのまま読む（既存の仕組みに合わせる）。
const KEY_ALARM_TIME = '@wakeupapp:alarmTime'; // "7:15" のような "時:分"
const KEY_ALARM_ENABLED = '@wakeupapp:alarmEnabled'; // "true" / "false"

// アラーム時刻から何分後にメッセージをリセットするか（30分）。
const RESET_AFTER_MS = 30 * 60 * 1000;

// 保存されているアラーム時刻（時・分）と ON/OFF を読む。
export async function getSavedAlarm(): Promise<{
  enabled: boolean;
  hour: number;
  minute: number;
}> {
  const time = await AsyncStorage.getItem(KEY_ALARM_TIME);
  const enabledStr = await AsyncStorage.getItem(KEY_ALARM_ENABLED);
  let hour = 7;
  let minute = 0;
  if (time) {
    const [h, m] = time.split(':').map(Number);
    hour = h;
    minute = m;
  }
  const enabled = enabledStr === null ? true : enabledStr === 'true';
  return { enabled, hour, minute };
}

// 「次に来る 時:分」の日時に +30分 した時刻（=リセット時刻）を計算する。
function computeExpiresAt(hour: number, minute: number): number {
  const now = new Date();
  const next = new Date();
  next.setHours(hour, minute, 0, 0);
  // その時刻がもう過ぎていれば、翌日の同時刻にする。
  if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 1);
  }
  return next.getTime() + RESET_AFTER_MS;
}

// メッセージを保存する。あわせて「アラーム時刻＋30分」のリセット時刻も記録する。
export async function saveTomorrowMessage(text: string): Promise<void> {
  const { hour, minute } = await getSavedAlarm();
  const expiresAt = computeExpiresAt(hour, minute);
  await AsyncStorage.setItem(KEY_TEXT, text);
  await AsyncStorage.setItem(KEY_EXPIRES, String(expiresAt));
}

// メッセージを読む。リセット時刻を過ぎていたら空にして '' を返す。
export async function loadTomorrowMessage(): Promise<string> {
  const text = await AsyncStorage.getItem(KEY_TEXT);
  if (!text) return '';
  const expiresStr = await AsyncStorage.getItem(KEY_EXPIRES);
  const expiresAt = expiresStr ? Number(expiresStr) : 0;
  if (expiresAt && Date.now() >= expiresAt) {
    await clearTomorrowMessage(); // 期限切れ → 空にする
    return '';
  }
  return text;
}

// メッセージを消す。
export async function clearTomorrowMessage(): Promise<void> {
  await AsyncStorage.removeItem(KEY_TEXT);
  await AsyncStorage.removeItem(KEY_EXPIRES);
}
