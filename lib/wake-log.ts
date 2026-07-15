// 起床記録（カレンダー・連続起床・すっぽかし回数）のロジック。
//
// なぜ Firestore に置くか：
//   「相手の今月のすっぽかし回数」を見せる必要があるため。端末内（AsyncStorage）保存だと
//   他人のデータは絶対に読めないので、ここは Firestore でないと成立しない。
//
// データの形：
//   users/{uid}/wakeLogs/{2026-07-15} … 自分のカレンダー用の1日分
//       { woke: true/false, partnerName, alarmTime, at }
//   users/{uid}.noShow = { "2026-07": 2 }  … 月ごとのすっぽかし回数
//       （相手のユーザー情報を1回読むだけで分かるよう、あえて数を持たせている）
//   users/{uid}.streak = { count, lastDate } … 連続起床

import {
  collection,
  doc,
  increment,
  onSnapshot,
  runTransaction,
  setDoc,
} from 'firebase/firestore';
import { db } from '../firebase';

// 1日分の記録。
export type WakeLog = {
  date: string; // "2026-07-15"
  woke: boolean; // アラームを止めたら true、すっぽかしたら false
  partnerName: string; // その日のマッチ相手
  alarmTime: string; // "7:00"
};

// Date から "2026-07-15" を作る。
export function toDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, '0');
  const d = `${date.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Date から "2026-07" を作る（月ごとのすっぽかし回数のキー）。
export function toMonthKey(date: Date): string {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, '0');
  return `${y}-${m}`;
}

// 「起きた」を記録する（アラームを止めた時に呼ぶ）。連続起床も更新する。
export async function recordWoke(
  uid: string,
  partnerName: string,
  alarmTime: string,
): Promise<void> {
  const now = new Date();
  const dateKey = toDateKey(now);

  // その日の記録を残す（同じ日に2回押しても上書きされるだけ）。
  await setDoc(doc(db, 'users', uid, 'wakeLogs', dateKey), {
    date: dateKey,
    woke: true,
    partnerName,
    alarmTime,
    at: now.getTime(),
  });

  // 連続起床を更新する。前回が「昨日」なら +1、それ以外は 1 に戻す。
  await runTransaction(db, async (tx) => {
    const userRef = doc(db, 'users', uid);
    const snap = await tx.get(userRef);
    const streak = snap.get('streak') ?? { count: 0, lastDate: null };
    if (streak.lastDate === dateKey) return; // 今日はもう数えている

    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const nextCount = streak.lastDate === toDateKey(yesterday) ? (streak.count ?? 0) + 1 : 1;

    tx.update(userRef, { streak: { count: nextCount, lastDate: dateKey } });
  });
}

// 「すっぽかした」を記録する（マッチしていたのに起きないまま自動OFFを迎えた時に呼ぶ）。
// 月ごとのすっぽかし回数を +1 し、連続起床は途切れさせる。
export async function recordNoShow(
  uid: string,
  partnerName: string,
  alarmTime: string,
): Promise<void> {
  const now = new Date();
  const dateKey = toDateKey(now);
  const monthKey = toMonthKey(now);

  await setDoc(doc(db, 'users', uid, 'wakeLogs', dateKey), {
    date: dateKey,
    woke: false,
    partnerName,
    alarmTime,
    at: now.getTime(),
  });

  // 相手から見える「今月のすっぽかし回数」を +1。連続起床は 0 に戻す。
  await runTransaction(db, async (tx) => {
    const userRef = doc(db, 'users', uid);
    await tx.get(userRef); // 読み取りを先に済ませる（Firestoreの決まり）
    tx.update(userRef, {
      [`noShow.${monthKey}`]: increment(1),
      streak: { count: 0, lastDate: null },
    });
  });
}

// 自分の記録をリアルタイムで購読する（カレンダー表示用）。
// 戻り値は購読を止める関数。
export function subscribeWakeLogs(
  uid: string,
  onChange: (logs: Record<string, WakeLog>) => void,
): () => void {
  return onSnapshot(collection(db, 'users', uid, 'wakeLogs'), (snap) => {
    const logs: Record<string, WakeLog> = {};
    snap.docs.forEach((d) => {
      const data = d.data();
      logs[d.id] = {
        date: d.id,
        woke: data.woke === true,
        partnerName: data.partnerName ?? '',
        alarmTime: data.alarmTime ?? '',
      };
    });
    onChange(logs);
  });
}
