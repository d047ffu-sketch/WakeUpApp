// アラーム（予約ローカル通知）のロジック。
// expo-notifications を使い、指定時刻に毎日通知を出す。
// ※ ローカル通知は Expo Go でも動作する（リモートのプッシュ通知は開発ビルドが必要）。
// ※ アプリ完全終了中の確実な鳴動は OS の制約で保証できないが、予約通知は出る。

import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { loadTomorrowMessage } from './tomorrow-message';

// 通知はスマホ（iOS / Android）専用。web では expo-notifications の各メソッドが
// 例外を投げるため、web のときは何もしない（no-op）ようにガードする。
const isWeb = Platform.OS === 'web';

// アプリ表示中（フォアグラウンド）でも通知をバナー表示・音を鳴らす設定。
// モジュール読み込み時に1回だけ設定する。
if (!isWeb) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

// Android で使う通知チャンネルのID。
const ANDROID_CHANNEL_ID = 'alarm';

// 通知の許可をユーザーに求め、Android 用の通知チャンネルを用意する。
// 許可されたら true を返す。
export async function setupNotifications(): Promise<boolean> {
  if (isWeb) return false; // web では通知は使えない

  // Android はチャンネルが無いと音やヘッドアップ表示が出ない。
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
      name: 'アラーム',
      importance: Notifications.AndroidImportance.MAX,
      sound: 'default',
      vibrationPattern: [0, 250, 250, 250],
    });
  }

  // すでに許可済みならそのまま。未許可ならダイアログで尋ねる。
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;

  const requested = await Notifications.requestPermissionsAsync({
    ios: { allowAlert: true, allowBadge: true, allowSound: true },
  });
  return requested.granted;
}

// 毎日 指定時刻（時・分）に鳴る予約通知をセットする。
// 古い予約を消してから入れ直すので、二重に鳴らない。
export async function scheduleDailyAlarm(hour: number, minute: number): Promise<void> {
  if (isWeb) return;
  // 「明日の自分へのメッセージ」があれば、通知本文にそのメッセージを載せる。
  const message = await loadTomorrowMessage();
  const body = message
    ? `昨日の23時のあなたから：\n「${message}」`
    : 'アプリを開いてアラームを止めると、誰かとマッチングできます。';

  await Notifications.cancelAllScheduledNotificationsAsync();
  await Notifications.scheduleNotificationAsync({
    content: {
      title: '⏰ 起きる時間です！',
      body,
      sound: 'default',
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour,
      minute,
      channelId: ANDROID_CHANNEL_ID,
    },
  });
}

// 予約通知をすべて取り消す（アラームOFF時に使う）。
export async function cancelAlarm(): Promise<void> {
  if (isWeb) return;
  await Notifications.cancelAllScheduledNotificationsAsync();
}

// テスト用：数秒後に1回だけ通知を出す（本物の通知が届くか確認するため）。
export async function scheduleTestNotification(seconds = 5): Promise<void> {
  if (isWeb) return;
  await Notifications.scheduleNotificationAsync({
    content: {
      title: '⏰ 起きる時間です！（テスト）',
      body: 'これはテスト通知です。アプリを開いてアラームを止めてみましょう。',
      sound: 'default',
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds,
      channelId: ANDROID_CHANNEL_ID,
    },
  });
}
