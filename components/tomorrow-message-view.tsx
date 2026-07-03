// 「昨日の23時のあなたから」のメッセージ表示（アラームを止める画面で使う）。
// 保存済みのメッセージがあれば表示し、無ければ何も表示しない。

import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { loadTomorrowMessageWithTime } from '../lib/tomorrow-message';

export function TomorrowMessageView() {
  const [data, setData] = useState<{ text: string; timeLabel: string } | null>(null);

  useEffect(() => {
    loadTomorrowMessageWithTime().then(setData);
  }, []);

  // メッセージが無ければ何も出さない。
  if (!data) return null;

  // 「昨日の◯◯のあなたから」。入力時刻が記録されていればその時刻を使う。
  const fromLabel = data.timeLabel ? `昨日の${data.timeLabel}のあなたから` : '昨日のあなたから';

  return (
    <View style={styles.box}>
      <Text style={styles.from}>{fromLabel}</Text>
      <Text style={styles.text}>{data.text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    marginBottom: 28,
    maxWidth: 320,
    borderWidth: 1,
    borderColor: '#e0e4e6',
  },
  from: {
    fontSize: 12,
    color: '#888',
    marginBottom: 6,
  },
  text: {
    fontSize: 16,
    color: '#1D3D47',
    lineHeight: 24,
  },
});
