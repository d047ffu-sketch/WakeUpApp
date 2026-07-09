import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../lib/auth-context';
import { getCoinLeaderboard } from '../../lib/wake-stats';

type LeaderboardEntry = {
  uid: string;
  nickname: string;
  coinBalance: number;
  rank: number;
};

export default function TotalScreen() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await getCoinLeaderboard();
      if (!cancelled) {
        setLeaderboard(result);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const currentUserEntry = leaderboard.find((entry) => entry.uid === user?.uid);

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#1D3D47" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.inner}>
        <Text style={styles.title}>コインランキング</Text>
        <Text style={styles.subtitle}>総所持コイン数で名誉ランキングを表示します。</Text>

        <View style={styles.card}>
          <Text style={styles.label}>あなたの順位</Text>
          <Text style={styles.value}>#{currentUserEntry?.rank ?? '—'}</Text>
          <Text style={styles.muted}>{currentUserEntry?.coinBalance ?? 0} コイン</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>ランキング</Text>
          {leaderboard.map((entry) => {
            const isMe = entry.uid === user?.uid;
            return (
              <View key={entry.uid} style={[styles.rankRow, isMe && styles.rankRowMe]}>
                <Text style={styles.rankText}>#{entry.rank}</Text>
                <Text style={styles.nicknameText}>{entry.nickname}</Text>
                <Text style={styles.coinText}>{entry.coinBalance}コイン</Text>
              </View>
            );
          })}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f2f4f5',
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  inner: {
    flex: 1,
    padding: 24,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#1D3D47',
  },
  subtitle: {
    marginTop: 6,
    color: '#666',
    lineHeight: 20,
  },
  card: {
    marginTop: 16,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
  },
  label: {
    fontSize: 14,
    color: '#666',
    marginBottom: 8,
  },
  value: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#1D3D47',
  },
  muted: {
    marginTop: 6,
    color: '#777',
  },
  rankRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#eef2f3',
  },
  rankRowMe: {
    backgroundColor: '#f4f8fb',
    borderRadius: 10,
    paddingHorizontal: 8,
  },
  rankText: {
    width: 40,
    fontWeight: 'bold',
    color: '#1D3D47',
  },
  nicknameText: {
    flex: 1,
    color: '#333',
    fontWeight: '600',
  },
  coinText: {
    color: '#F4B400',
    fontWeight: '700',
  },
});
