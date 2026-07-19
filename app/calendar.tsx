// カレンダー画面
// ・上に「連続起床」
// ・起きた日／すっぽかした日を色分け（記録が無い日は色を付けない）
// ・起きた日はマッチ相手と時刻を表示
//
// データは Firestore の users/{uid}/wakeLogs から読む（端末内保存ではないので
// 機種変更しても残り、相手の記録とも同じ仕組みで扱える）。

import { Stack, useRouter } from 'expo-router';
import { doc, onSnapshot } from 'firebase/firestore';
import { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import AppSafeArea from '@/components/app-safe-area';
import { db } from '../firebase';
import { useAuth } from '../lib/auth-context';
import { subscribeWakeLogs, toDateKey, type WakeLog } from '../lib/wake-log';

export default function CalendarScreen() {
  const { user } = useAuth();
  const router = useRouter();

  const [logs, setLogs] = useState<Record<string, WakeLog>>({});
  const [streakData, setStreakData] = useState<{ count: number; lastDate: string | null }>({
    count: 0,
    lastDate: null,
  });
  // 表示している月の1日。
  const [viewMonth, setViewMonth] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return d;
  });
  const [selectedDate, setSelectedDate] = useState(() => toDateKey(new Date()));

  // 自分の起床記録を購読する。
  useEffect(() => {
    if (!user) return;
    return subscribeWakeLogs(user.uid, setLogs);
  }, [user]);

  // 連続起床を購読する。
  useEffect(() => {
    if (!user) return;
    return onSnapshot(doc(db, 'users', user.uid), (snap) => {
      const s = snap.data()?.streak;
      setStreakData({ count: s?.count ?? 0, lastDate: s?.lastDate ?? null });
    });
  }, [user]);

  // 表示用の連続日数。
  // 最終起床日が「今日」でも「昨日」でもなければ、連続はすでに途切れているので 0 にする。
  // （保存値をそのまま出すと、サボっても古い日数が残り続けてしまう）
  const streak = useMemo(() => {
    if (!streakData.lastDate) return 0;
    const today = toDateKey(new Date());
    const y = new Date();
    y.setDate(y.getDate() - 1);
    if (streakData.lastDate === today || streakData.lastDate === toDateKey(y)) {
      return streakData.count;
    }
    return 0;
  }, [streakData]);

  // 今月のすっぽかし回数（自分の分）。
  const monthPrefix = `${viewMonth.getFullYear()}-${`${viewMonth.getMonth() + 1}`.padStart(2, '0')}`;
  const monthStats = useMemo(() => {
    let woke = 0;
    let missed = 0;
    Object.values(logs).forEach((log) => {
      if (!log.date.startsWith(monthPrefix)) return;
      if (log.woke) woke += 1;
      else missed += 1;
    });
    return { woke, missed };
  }, [logs, monthPrefix]);

  // 月のマス目を作る（月曜始まり。空白は null）。
  const days = useMemo(() => buildMonthDays(viewMonth), [viewMonth]);
  const selectedLog = logs[selectedDate];

  const shiftMonth = (delta: number) => {
    const d = new Date(viewMonth);
    d.setMonth(d.getMonth() + delta, 1);
    setViewMonth(d);
  };

  return (
    <AppSafeArea style={styles.container}>
      {/* 画面が独自のヘッダーを出すので、ルート側のヘッダーは消す（二重表示を防ぐ） */}
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Text style={styles.backText}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>カレンダー</Text>
        <View style={styles.backButton} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {/* 連続起床 */}
        <View style={styles.streakCard}>
          <Text style={styles.streakLabel}>連続起床</Text>
          <Text style={styles.streakValue}>{streak}日</Text>
        </View>

        <View style={styles.card}>
          {/* 月の切り替え */}
          <View style={styles.monthNav}>
            <TouchableOpacity style={styles.navButton} onPress={() => shiftMonth(-1)}>
              <Text style={styles.navText}>‹</Text>
            </TouchableOpacity>
            <Text style={styles.monthLabel}>
              {viewMonth.getFullYear()}年{viewMonth.getMonth() + 1}月
            </Text>
            <TouchableOpacity style={styles.navButton} onPress={() => shiftMonth(1)}>
              <Text style={styles.navText}>›</Text>
            </TouchableOpacity>
          </View>

          {/* 今月の内訳 */}
          <Text style={styles.monthStats}>
            起きた {monthStats.woke}日 ・ すっぽかし {monthStats.missed}日
          </Text>

          {/* 曜日 */}
          <View style={styles.weekRow}>
            {['月', '火', '水', '木', '金', '土', '日'].map((label) => (
              <Text key={label} style={styles.weekLabel}>
                {label}
              </Text>
            ))}
          </View>

          {/* 日付のマス */}
          <View style={styles.grid}>
            {days.map((dayKey, index) => {
              if (!dayKey) return <View key={`empty-${index}`} style={styles.cell} />;

              const log = logs[dayKey];
              const isSelected = dayKey === selectedDate;
              const day = Number(dayKey.split('-')[2]);

              return (
                <TouchableOpacity
                  key={dayKey}
                  style={[
                    styles.cell,
                    // 記録がある日だけ色を付ける（記録が無い日は無色のまま）
                    log?.woke && styles.cellWoke,
                    log && !log.woke && styles.cellMissed,
                    isSelected && styles.cellSelected,
                  ]}
                  onPress={() => setSelectedDate(dayKey)}>
                  <Text style={[styles.dayNumber, log && styles.dayNumberOnColor]}>{day}</Text>
                  {/* 起きた日は相手と時刻を表示 */}
                  {log?.woke ? (
                    <>
                      <Text style={styles.cellTime} numberOfLines={1}>
                        {log.alarmTime}
                      </Text>
                      <Text style={styles.cellPartner} numberOfLines={1}>
                        {log.partnerName || '—'}
                      </Text>
                    </>
                  ) : null}
                  {log && !log.woke ? <Text style={styles.cellMissedMark}>✕</Text> : null}
                </TouchableOpacity>
              );
            })}
          </View>

          {/* 凡例 */}
          <View style={styles.legend}>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, styles.cellWoke]} />
              <Text style={styles.legendText}>起きた</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, styles.cellMissed]} />
              <Text style={styles.legendText}>すっぽかし</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, styles.legendDotNone]} />
              <Text style={styles.legendText}>記録なし</Text>
            </View>
          </View>
        </View>

        {/* 選んだ日の詳細 */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{formatDateLabel(selectedDate)}</Text>
          {selectedLog ? (
            selectedLog.woke ? (
              <>
                <Text style={styles.detailOk}>起きました 🎉</Text>
                <Text style={styles.detailLine}>時刻：{selectedLog.alarmTime}</Text>
                <Text style={styles.detailLine}>
                  お相手：{selectedLog.partnerName || '（相手なし）'}
                </Text>
              </>
            ) : (
              <>
                <Text style={styles.detailNg}>すっぽかしました</Text>
                <Text style={styles.detailLine}>
                  {selectedLog.partnerName || '相手'} さんを {selectedLog.alarmTime} に待たせてしまいました
                </Text>
              </>
            )
          ) : (
            <Text style={styles.detailNone}>この日の記録はありません。</Text>
          )}
        </View>
      </ScrollView>
    </AppSafeArea>
  );
}

// その月のマス目（月曜始まり）を作る。前後の空きは null。
function buildMonthDays(month: Date): (string | null)[] {
  const year = month.getFullYear();
  const m = month.getMonth();
  const first = new Date(year, m, 1);
  const last = new Date(year, m + 1, 0);
  const days: (string | null)[] = [];

  // 月曜始まりにするための先頭の空き。
  const leading = (first.getDay() + 6) % 7;
  for (let i = 0; i < leading; i += 1) days.push(null);

  for (let d = 1; d <= last.getDate(); d += 1) {
    days.push(toDateKey(new Date(year, m, d)));
  }
  while (days.length % 7 !== 0) days.push(null);
  return days;
}

// "2026-07-15" → "7月15日"
function formatDateLabel(dateKey: string): string {
  const [, m, d] = dateKey.split('-').map(Number);
  return `${m}月${d}日`;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f2f4f5' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  backText: { fontSize: 26, color: '#1D3D47', lineHeight: 28 },
  headerTitle: { fontSize: 18, fontWeight: '700', color: '#1D3D47' },
  content: { padding: 16, paddingBottom: 32 },
  streakCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#1D3D47',
    borderRadius: 16,
    paddingHorizontal: 20,
    paddingVertical: 18,
    marginBottom: 16,
  },
  streakLabel: { color: '#cfdde2', fontSize: 15, fontWeight: '600' },
  streakValue: { color: '#fff', fontSize: 30, fontWeight: 'bold' },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  cardTitle: { fontSize: 16, fontWeight: '700', color: '#1D3D47', marginBottom: 10 },
  monthNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  navButton: { paddingHorizontal: 16, paddingVertical: 4 },
  navText: { fontSize: 24, color: '#1D3D47', lineHeight: 26 },
  monthLabel: { fontSize: 16, fontWeight: '700', color: '#1D3D47' },
  monthStats: { fontSize: 12, color: '#8a969b', textAlign: 'center', marginBottom: 12 },
  weekRow: { flexDirection: 'row', marginBottom: 4 },
  weekLabel: { flex: 1, textAlign: 'center', fontSize: 11, color: '#8a969b' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: {
    width: `${100 / 7}%`,
    aspectRatio: 0.78,
    borderRadius: 8,
    paddingTop: 3,
    alignItems: 'center',
  },
  cellWoke: { backgroundColor: '#2e9e5b' },
  cellMissed: { backgroundColor: '#e05a5a' },
  cellSelected: { borderWidth: 2, borderColor: '#1D3D47' },
  dayNumber: { fontSize: 12, fontWeight: '700', color: '#33474e' },
  dayNumberOnColor: { color: '#fff' },
  cellTime: { fontSize: 9, color: '#fff', fontWeight: '700' },
  cellPartner: { fontSize: 8, color: '#eaf7ef', paddingHorizontal: 2 },
  cellMissedMark: { fontSize: 12, color: '#fff', fontWeight: 'bold', marginTop: 2 },
  legend: { flexDirection: 'row', justifyContent: 'center', gap: 14, marginTop: 12 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 10, height: 10, borderRadius: 3 },
  legendDotNone: { backgroundColor: '#e6eaec' },
  legendText: { fontSize: 11, color: '#8a969b' },
  detailOk: { fontSize: 16, fontWeight: '700', color: '#2e9e5b', marginBottom: 8 },
  detailNg: { fontSize: 16, fontWeight: '700', color: '#e05a5a', marginBottom: 8 },
  detailLine: { fontSize: 14, color: '#33474e', lineHeight: 22 },
  detailNone: { fontSize: 14, color: '#8a969b' },
});
