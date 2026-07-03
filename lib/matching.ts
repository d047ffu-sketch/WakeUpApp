// マッチングのロジック（サーバー無し・Firestore だけで実現）
//
// 流れ：
//   1. joinMatchingPool() … 自分を待機列（matching_pool）に登録する
//   2. tryMatch()        … 待機中の相手を探し、トランザクションでペアを作る
//   3. leaveMatchingPool() … 待機をやめる（キャンセル）
//
// 同時に2人が「お互いを相手」として処理しても、トランザクションが同じ2つの
// プールDocを読むため、先にコミットした方だけが成立し、もう片方は自動でリトライ
// →相手がもういない→中止、という形で「2人で1部屋」を保証する（Firestoreの楽観ロック）。

import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { db } from '../firebase';

// 待機列に参加する。
// あわせて自分のステータスを matching にし、前回のチャット部屋IDは空に戻しておく。
export async function joinMatchingPool(uid: string): Promise<void> {
  await updateDoc(doc(db, 'users', uid), {
    status: 'matching',
    currentRoomId: '', // 前回の部屋IDが残っていると誤遷移するのでクリア
  });
  await setDoc(doc(db, 'matching_pool', uid), {
    joinedAt: Date.now(), // 待機開始時刻（古い順に並べるために使う）
  });
}

// 待機中の相手を探してペアを作る。
// 成立したら部屋IDを返す。相手がいなければ null（=このまま待機を続ける）。
export async function tryMatch(uid: string): Promise<string | null> {
  // 相手が他の人に取られていたら、別の相手で何回か挑戦する。
  for (let attempt = 0; attempt < 5; attempt++) {
    // 待機列を古い順に取得し、自分以外の先頭を相手候補にする。
    const poolSnap = await getDocs(query(collection(db, 'matching_pool'), orderBy('joinedAt')));
    const partnerDoc = poolSnap.docs.find((d) => d.id !== uid);
    if (!partnerDoc) return null; // 自分しかいない → 待機継続
    const partnerId = partnerDoc.id;

    // 同じ2人なら必ず同じ部屋IDになるよう、UIDを並べ替えて連結する。
    // → 何度マッチしても同じ部屋を使い、過去のメッセージがそのまま履歴として残る。
    const roomId = [uid, partnerId].sort().join('_');

    const myPoolRef = doc(db, 'matching_pool', uid);
    const partnerPoolRef = doc(db, 'matching_pool', partnerId);

    // トランザクション：読み取りを全部済ませてから書き込む（Firestoreの決まり）。
    const result = await runTransaction(db, async (tx) => {
      const mine = await tx.get(myPoolRef);
      const partner = await tx.get(partnerPoolRef);
      // どちらかが既にプールにいない（=他で成立済み or キャンセル済み）なら中止。
      if (!mine.exists() || !partner.exists()) return null;

      // 履歴一覧で名前を出すために、2人のニックネームも読んでおく。
      const myUser = await tx.get(doc(db, 'users', uid));
      const partnerUser = await tx.get(doc(db, 'users', partnerId));

      // 部屋を用意する。merge:true なので既存のメッセージや lastMessage は消えない。
      // sessionStartedAt = 今回の会話の開始時刻（5分カウントダウンの基準。再会のたびに更新）。
      tx.set(
        doc(db, 'rooms', roomId),
        {
          participants: [uid, partnerId],
          names: {
            [uid]: myUser.get('nickname') ?? '',
            [partnerId]: partnerUser.get('nickname') ?? '',
          },
          sessionStartedAt: serverTimestamp(),
          lastActivityAt: serverTimestamp(),
        },
        { merge: true },
      );
      // 両者を「チャット中」にし、部屋IDを書き込む（これで両者が遷移できる）。
      tx.update(doc(db, 'users', uid), { status: 'chatting', currentRoomId: roomId });
      tx.update(doc(db, 'users', partnerId), { status: 'chatting', currentRoomId: roomId });
      // 待機列から両者を外す。
      tx.delete(myPoolRef);
      tx.delete(partnerPoolRef);
      return roomId;
    });

    if (result) return result; // 成立
    // null だった場合（相手が取られていた等）→ ループで別の相手を探す
  }
  return null; // 何回か試したが相手が見つからなかった → 待機継続
}

// 待機をやめる（キャンセル）。プールから自分を外し、ステータスを online に戻す。
export async function leaveMatchingPool(uid: string): Promise<void> {
  await deleteDoc(doc(db, 'matching_pool', uid)).catch(() => {});
  await updateDoc(doc(db, 'users', uid), { status: 'online' }).catch(() => {});
}
