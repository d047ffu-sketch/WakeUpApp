import { collection, getDocs } from 'firebase/firestore';
import { db } from '../firebase';

export function getDateKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getYesterdayKey(date = new Date()): string {
  const yesterday = new Date(date);
  yesterday.setDate(yesterday.getDate() - 1);
  return getDateKey(yesterday);
}

export async function getCoinLeaderboard() {
  const usersSnap = await getDocs(collection(db, 'users'));
  const rows = usersSnap.docs.map((snapshot) => {
    const data = snapshot.data();
    return {
      uid: snapshot.id,
      nickname: data.nickname ?? '名無しさん',
      coinBalance: Number(data.coinBalance ?? 0),
    };
  });

  rows.sort((a, b) => b.coinBalance - a.coinBalance || a.nickname.localeCompare(b.nickname, 'ja'));

  return rows.map((row, index) => ({
    ...row,
    rank: index + 1,
  }));
}

export async function getWakeStatsForDate(dateKey: string) {
  const usersSnap = await getDocs(collection(db, 'users'));
  let totalAlarmSetters = 0;
  let totalAwoke = 0;

  usersSnap.forEach((snapshot) => {
    const data = snapshot.data();
    if (data.alarmSetDate === dateKey) {
      totalAlarmSetters += 1;
      if (data.wakeConfirmDate === dateKey) {
        totalAwoke += 1;
      }
    }
  });

  const totalMissed = Math.max(0, totalAlarmSetters - totalAwoke);
  const wakeRate = totalAlarmSetters > 0 ? totalAwoke / totalAlarmSetters : 0;
  const missedRate = totalAlarmSetters > 0 ? totalMissed / totalAlarmSetters : 0;
  const multiplier = 2 + Math.min(6, Math.round(missedRate * 10));

  return {
    dateKey,
    totalAlarmSetters,
    totalAwoke,
    totalMissed,
    wakeRate,
    missedRate,
    multiplier,
  };
}
