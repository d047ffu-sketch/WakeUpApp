// マッチングのロジック（サーバー無し・Firestore だけで実現）— 事前マッチ方式
//
// 新しい流れ：
//   1. アラームの1時間前〜アラーム時刻の間に、同じアラーム時刻の人同士をマッチさせる
//      （joinMatchingPool → tryMatch）。相手が決まると rooms が作られる。
//   2. アラーム時刻に各自「アラームを止める」と markAwake で自分の起床を記録。
//   3. 相手がまだ起きていなければ sendWakePing で「起きて！」の合図を送る。
//   4. 2人とも起きたら sessionStartedAt がセットされ、トークルーム（5分チャット）へ。

import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  increment,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { db } from '../firebase';

// 起きた合図として、相手に「朝の一言」を送る。
// ・チャットのメッセージとして追加する → トークルームでそのまま会話の1言目になる
// ・部屋にも控えを置く → 相手はまだ寝ていて鳴動画面にいるので、そこで見せられる
export async function sendWakeMessage(
  roomId: string,
  uid: string,
  text: string,
): Promise<void> {
  await addDoc(collection(db, 'rooms', roomId, 'messages'), {
    senderId: uid,
    text,
    createdAt: serverTimestamp(),
  });
  await updateDoc(doc(db, 'rooms', roomId), {
    [`wakeMessages.${uid}`]: text, // 相手の鳴動画面に出すための控え
    lastMessage: text,
    lastActivityAt: serverTimestamp(),
  });
}

// 待機列を監視して「アラーム時刻ごとの待機者数」を返す。
// 自分自身は数えない（＝マッチできる相手が何人いるか）。
// 戻り値は購読を止める関数。
export function subscribeWaitingCounts(
  selfUid: string,
  onChange: (counts: Record<string, number>) => void,
): () => void {
  return onSnapshot(collection(db, 'matching_pool'), (snap) => {
    const counts: Record<string, number> = {};
    snap.docs.forEach((d) => {
      if (d.id === selfUid) return; // 自分は除く
      const data = d.data();
      if (data.enabled !== true) return; // アラームONの人だけ
      const time = data.alarmTime;
      if (!time) return;
      counts[time] = (counts[time] ?? 0) + 1;
    });
    onChange(counts);
  });
}

// 待機列に参加する。「同じアラーム時刻の人」を探すため alarmTime も保存する。
// enabled はアラームがオンの人だけをマッチ対象にするための目印（登録時は必ずオン）。
export async function joinMatchingPool(uid: string, alarmTime: string): Promise<void> {
  await updateDoc(doc(db, 'users', uid), {
    status: 'matching',
    currentRoomId: '', // 前回の部屋IDが残っていると誤遷移するのでクリア
  });
  await setDoc(doc(db, 'matching_pool', uid), {
    alarmTime, // "7:00" のような時刻文字列
    enabled: true, // アラームがオンの人だけがマッチ対象
    joinedAt: Date.now(),
  });
}

// 待機列から外す（アラームをオフにした時などに使う。ステータスは変えない）。
export async function removeFromPool(uid: string): Promise<void> {
  await deleteDoc(doc(db, 'matching_pool', uid)).catch(() => {});
}

// 同じアラーム時刻の相手を探してペアを作る。
// 成立したら部屋IDを返す。相手がいなければ null（=このまま待機を続ける）。
export async function tryMatch(uid: string, alarmTime: string): Promise<string | null> {
  for (let attempt = 0; attempt < 5; attempt++) {
    // 同じ alarmTime の待機者を取得（equality だけなので複合索引は不要）。
    // その中から「自分以外」かつ「アラームがオン(enabled)」の人だけを相手候補にし、
    // 待機開始が一番早い人を選ぶ。← マッチ条件は「オン かつ 同じ時刻」。
    const poolSnap = await getDocs(
      query(collection(db, 'matching_pool'), where('alarmTime', '==', alarmTime)),
    );
    const candidates = poolSnap.docs
      .filter((d) => d.id !== uid && d.data().enabled === true)
      .sort((a, b) => (a.data().joinedAt ?? 0) - (b.data().joinedAt ?? 0));
    if (candidates.length === 0) return null; // 同時刻でオンの相手がいない → 待機継続
    const partnerId = candidates[0].id;

    // 同じ2人なら必ず同じ部屋IDになるよう、UIDを並べ替えて連結する（履歴が残る）。
    const roomId = [uid, partnerId].sort().join('_');
    const myPoolRef = doc(db, 'matching_pool', uid);
    const partnerPoolRef = doc(db, 'matching_pool', partnerId);

    const result = await runTransaction(db, async (tx) => {
      const mine = await tx.get(myPoolRef);
      const partner = await tx.get(partnerPoolRef);
      if (!mine.exists() || !partner.exists()) return null; // 相手が既に取られた等 → 中止
      const myUser = await tx.get(doc(db, 'users', uid));
      const partnerUser = await tx.get(doc(db, 'users', partnerId));

      // 部屋を用意する。merge:true で既存メッセージは温存しつつ、今回のセッション用に
      // awake（起床フラグ）をリセットし、前回の sessionStartedAt / wakePing も消す。
      tx.set(
        doc(db, 'rooms', roomId),
        {
          participants: [uid, partnerId],
          names: {
            [uid]: myUser.get('nickname') ?? '',
            [partnerId]: partnerUser.get('nickname') ?? '',
          },
          alarmTime,
          awake: { [uid]: false, [partnerId]: false },
          sessionStartedAt: null, // 2人とも起きたらセットされる（5分タイマー開始）
          wakePing: null,
          wakeMessages: null, // 今回の「朝の一言」は空から始める
          matchedAt: serverTimestamp(),
          lastActivityAt: serverTimestamp(),
        },
        { merge: true },
      );
      // 両者に「この部屋とマッチ済み」を記録（onSnapshot で検知して待機画面に進む）。
      tx.update(doc(db, 'users', uid), { status: 'chatting', currentRoomId: roomId });
      tx.update(doc(db, 'users', partnerId), { status: 'chatting', currentRoomId: roomId });
      tx.delete(myPoolRef);
      tx.delete(partnerPoolRef);
      return roomId;
    });

    if (result) return result;
  }
  return null;
}

// 待機をやめる（プールから外し、ステータスを online に戻す）。
export async function leaveMatchingPool(uid: string): Promise<void> {
  await deleteDoc(doc(db, 'matching_pool', uid)).catch(() => {});
  await updateDoc(doc(db, 'users', uid), { status: 'online' }).catch(() => {});
}

// 自分が「起きた（アラームを止めた）」ことを部屋に記録する。
// 2人とも起きたら sessionStartedAt をセットし（＝トーク開始・5分計測の基準）、
// 「実際に話せた回数」を両者に1回ずつ加算する（＝「◯回目です」の元データ）。
export async function markAwake(uid: string, roomId: string): Promise<void> {
  await runTransaction(db, async (tx) => {
    const roomRef = doc(db, 'rooms', roomId);
    const room = await tx.get(roomRef); // 読み取りは書き込みより先に行う

    if (!room.exists()) return;

    const awake: Record<string, boolean> = { ...(room.get('awake') ?? {}), [uid]: true };
    const participants: string[] = room.get('participants') ?? [];
    const bothAwake = participants.every((id) => awake[id]);

    const update: Record<string, unknown> = { awake };
    // 2人とも起きた瞬間に、まだ無ければ開始時刻をセットする。
    if (bothAwake && !room.get('sessionStartedAt')) {
      update.sessionStartedAt = serverTimestamp();

      // ここで初めて「実際に話せた」とみなし、お互いの会った回数を +1 する。
      // （マッチしただけ・すっぽかされた相手は数えない）
      const partnerId = participants.find((id) => id !== uid);
      if (partnerId) {
        tx.update(doc(db, 'users', uid), { [`metCount.${partnerId}`]: increment(1) });
        tx.update(doc(db, 'users', partnerId), { [`metCount.${uid}`]: increment(1) });
      }
    }
    tx.update(roomRef, update);
  });
}

// 「起きて！」の合図を送る。相手のアプリがこの変化を検知して通知を鳴らす。
// at は毎回変わるので、相手側が「新しい合図」として検知できる。
export async function sendWakePing(roomId: string, targetUid: string): Promise<void> {
  await updateDoc(doc(db, 'rooms', roomId), {
    wakePing: { to: targetUid, at: Date.now() },
  });
}

// マッチをやめる（トーク待機画面のキャンセル）。
// 自分の起床フラグを下ろし（相手が誤ってトークへ進まないように）、
// 自分のステータスを online に戻して、マッチ解除する。
export async function cancelMatch(uid: string, roomId: string): Promise<void> {
  await updateDoc(doc(db, 'rooms', roomId), { [`awake.${uid}`]: false }).catch(() => {});
  await updateDoc(doc(db, 'users', uid), { status: 'online', currentRoomId: '' }).catch(() => {});
}
