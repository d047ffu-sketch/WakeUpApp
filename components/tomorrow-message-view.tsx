// 「昨日の23時のあなたから」のメッセージ表示（アラームを止める画面で使う）。
// 保存済みのメッセージがあれば表示し、無ければ何も表示しない。

import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { loadTomorrowMessage } from '../lib/tomorrow-message';

export function TomorrowMessageView() {
  const [message, setMessage] = useState('');

  useEffect(() => {
    loadTomorrowMessage().then(setMessage);
  }, []);

  // メッセージが無ければ何も出さない。
  if (!message) return null;

  return (
    <View style={styles.box}>
      <Text style={styles.from}>昨日の23時のあなたから</Text>
      <Text style={styles.text}>{message}</Text>
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
