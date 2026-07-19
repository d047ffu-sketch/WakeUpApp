// マッチング成功画面
// マッチした相手のニックネームを表示し、3秒後に自動でトーク（チャット）画面へ移動する。

import { useLocalSearchParams, useRouter } from 'expo-router';
import { doc, getDoc } from 'firebase/firestore';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { db } from '../../firebase';
import { useAuth } from '../../lib/auth-context';
import { useBackgroundColor } from '../../lib/background-color-context';

// 何秒後にトーク画面へ移動するか。
const COUNTDOWN_SEC = 3;

export default function MatchSuccessScreen() {
  const { roomId } = useLocalSearchParams<{ roomId: string }>();
  const { user } = useAuth();
  const { backgroundColor } = useBackgroundColor();
  const router = useRouter();

  const [partnerName, setPartnerName] = useState('');
  const [count, setCount] = useState(COUNTDOWN_SEC);
  const navigatedRef = useRef(false); // 二重遷移を防ぐ

  // 相手のニックネームを取得する。
  useEffect(() => {
    if (!roomId || !user) return;
    (async () => {
      const roomSnap = await getDoc(doc(db, 'rooms', roomId));
      if (roomSnap.exists()) {
        const participants: string[] = roomSnap.data().participants ?? [];
        const partnerId = participants.find((id) => id !== user.uid);
        if (partnerId) {
          const partnerSnap = await getDoc(doc(db, 'users', partnerId));
          if (partnerSnap.exists()) setPartnerName(partnerSnap.data().nickname ?? '相手');
        }
      }
    })();
  }, [roomId, user]);

  // 1秒ごとにカウントダウン。0になったら止める。
  useEffect(() => {
    const id = setInterval(() => {
      setCount((c) => {
        if (c <= 1) {
          clearInterval(id);
          return 0;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // カウントが0になったらトーク画面へ移動（replace なので戻るときはホームに戻る）。
  useEffect(() => {
    if (count === 0 && roomId && !navigatedRef.current) {
      navigatedRef.current = true;
      router.replace({ pathname: '/chat/[roomId]', params: { roomId } });
    }
  }, [count, roomId, router]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor }]}>
      <View style={styles.inner}>
        <Text style={styles.emoji}>🎉</Text>
        <Text style={styles.title}>マッチング成功！</Text>

        <Text style={styles.partnerLabel}>お相手</Text>
        <Text style={styles.partnerName}>{partnerName || '...'} さん</Text>

        <Text style={styles.countdown}>あと {count} 秒でトーク画面に移動します</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1D3D47',
  },
  inner: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  emoji: {
    fontSize: 64,
    marginBottom: 12,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 40,
  },
  partnerLabel: {
    fontSize: 14,
    color: '#a9c3cc',
    marginBottom: 6,
  },
  partnerName: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 48,
  },
  countdown: {
    fontSize: 15,
    color: '#cfdde2',
  },
});
