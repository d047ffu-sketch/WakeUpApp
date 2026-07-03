// 「明日の自分へのメッセージ」の編集カード（ホーム画面の日時指定の下に置く）。
// ・メッセージが無いとき：「明日の自分に送る」ボタン → 押すと入力欄が出る
// ・メッセージがあるとき：内容を表示 ＋「編集」「削除」
// ・保存すると、翌朝のアラーム通知の本文にも反映される（予約し直す）

import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useState } from 'react';
import { Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { cancelAlarm, scheduleDailyAlarm } from '../lib/notifications';
import {
  clearTomorrowMessage,
  getSavedAlarm,
  loadTomorrowMessage,
  saveTomorrowMessage,
} from '../lib/tomorrow-message';

export function TomorrowMessageCard() {
  const [message, setMessage] = useState(''); // 保存済みメッセージ
  const [editing, setEditing] = useState(false); // 入力欄を表示中か
  const [draft, setDraft] = useState(''); // 入力中のテキスト

  // ホーム画面にフォーカスが戻るたびに最新を読み込む（30分リセットも反映される）。
  useFocusEffect(
    useCallback(() => {
      loadTomorrowMessage().then(setMessage);
    }, []),
  );

  // 保存/削除の後、通知本文にも反映されるようにアラームを予約し直す。
  const reschedule = async () => {
    const { enabled, hour, minute } = await getSavedAlarm();
    if (enabled) {
      await scheduleDailyAlarm(hour, minute);
    } else {
      await cancelAlarm();
    }
  };

  // 入力欄を開く（既存メッセージがあれば編集、無ければ新規）。
  const startCompose = () => {
    setDraft(message);
    setEditing(true);
  };

  // 送信（保存）。
  const handleSave = async () => {
    const text = draft.trim();
    if (!text) {
      Alert.alert('メッセージが空です', '内容を入力してください。');
      return;
    }
    await saveTomorrowMessage(text);
    setMessage(text);
    setEditing(false);
    await reschedule();
  };

  // 削除。
  const handleDelete = async () => {
    await clearTomorrowMessage();
    setMessage('');
    await reschedule();
  };

  return (
    <View style={styles.card}>
      <Text style={styles.title}>明日の自分へのメッセージ</Text>

      {editing ? (
        // ===== 入力中 =====
        <>
          <TextInput
            style={styles.input}
            value={draft}
            onChangeText={setDraft}
            placeholder="例：ちゃんと起きて偉い！今日も1日がんばろう"
            multiline
            maxLength={100}
            autoFocus
          />
          <View style={styles.row}>
            <TouchableOpacity
              style={[styles.btn, styles.btnGhost]}
              onPress={() => setEditing(false)}>
              <Text style={styles.btnGhostText}>キャンセル</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.btn, styles.btnPrimary]} onPress={handleSave}>
              <Text style={styles.btnPrimaryText}>送信</Text>
            </TouchableOpacity>
          </View>
        </>
      ) : message ? (
        // ===== メッセージあり（表示＋編集/削除） =====
        <>
          <View style={styles.messageBox}>
            <Text style={styles.messageText}>{message}</Text>
          </View>
          <View style={styles.row}>
            <TouchableOpacity style={[styles.btn, styles.btnGhost]} onPress={handleDelete}>
              <Text style={styles.btnGhostText}>削除</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.btn, styles.btnPrimary]} onPress={startCompose}>
              <Text style={styles.btnPrimaryText}>編集</Text>
            </TouchableOpacity>
          </View>
        </>
      ) : (
        // ===== メッセージなし（送るボタン） =====
        <TouchableOpacity style={styles.composeButton} onPress={startCompose}>
          <Text style={styles.composeButtonText}>明日の自分に送る</Text>
        </TouchableOpacity>
      )}

      <Text style={styles.note}>※ アラーム時刻の30分後に自動でリセットされます</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
    marginTop: 16,
  },
  title: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 12,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    minHeight: 60,
    textAlignVertical: 'top',
    marginBottom: 12,
  },
  messageBox: {
    backgroundColor: '#eef2f3',
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
  },
  messageText: {
    fontSize: 15,
    color: '#1D3D47',
    lineHeight: 22,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
  },
  btn: {
    paddingVertical: 8,
    paddingHorizontal: 18,
    borderRadius: 20,
  },
  btnPrimary: {
    backgroundColor: '#1D3D47',
  },
  btnPrimaryText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  btnGhost: {
    backgroundColor: '#eef2f3',
  },
  btnGhostText: {
    color: '#555',
    fontSize: 14,
    fontWeight: '600',
  },
  composeButton: {
    backgroundColor: '#eef2f3',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  composeButtonText: {
    color: '#1D3D47',
    fontSize: 16,
    fontWeight: 'bold',
  },
  note: {
    fontSize: 11,
    color: '#999',
    marginTop: 10,
  },
});
