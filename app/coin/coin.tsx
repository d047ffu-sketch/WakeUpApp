import { useAuth } from '@/lib/auth-context';
import { doc, onSnapshot } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { db } from '../../firebase';

const REWARD_MULTIPLIER = 2;

export default function CoinScreen() {
  const { user } = useAuth();
  const [coinBalance, setCoinBalance] = useState(0);
  const [pendingStake, setPendingStake] = useState(0);
  const [stakeStatus, setStakeStatus] = useState<'none' | 'active'>('none');

  useEffect(() => {
    if (!user) return;
    const userRef = doc(db, 'users', user.uid);
    const unsubscribe = onSnapshot(userRef, (snap) => {
      const data = snap.data();
      setCoinBalance(Number(data?.coinBalance ?? 0));
      setPendingStake(Number(data?.pendingStake ?? 0));
      setStakeStatus(data?.pendingStakeStatus === 'active' ? 'active' : 'none');
    });
    return () => unsubscribe();
  }, [user]);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.inner}>
        <Text style={styles.title}>コイン機能</Text>
        <Text style={styles.subtitle}>
          目覚ましを設定して起きたら、賭けたコインが{REWARD_MULTIPLIER}倍で戻ってきます。
        </Text>

        <View style={styles.card}>
          <Text style={styles.label}>保有コイン</Text>
          <Text style={styles.balance}>{coinBalance}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>今の賭け</Text>
          <Text style={styles.value}>{pendingStake} コイン</Text>
          <Text style={styles.value}>{stakeStatus === 'active' ? 'チャット結果待ち' : '未使用'}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>倍額で戻るルール</Text>
          <Text style={styles.value}>賭けたコインは{REWARD_MULTIPLIER}倍で返ってきます。</Text>
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
    marginTop: 8,
    color: '#666',
    lineHeight: 20,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    marginTop: 16,
  },
  label: {
    fontSize: 14,
    color: '#666',
  },
  balance: {
    marginTop: 8,
    fontSize: 32,
    fontWeight: 'bold',
    color: '#F4B400',
  },
  value: {
    marginTop: 8,
    fontSize: 16,
    color: '#1D3D47',
  },
});
