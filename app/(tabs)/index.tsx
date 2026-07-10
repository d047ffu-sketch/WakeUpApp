import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, Alert } from 'react-native';
import { Audio } from 'expo-av';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

// 🎵 音声ファイルのプールを静的に定義（Metroの制約により、動的な文字列結合パス指定ができないため）
// 備考：B0からB39までの計40個の音声をすべて静的に登録しています。
//    ファイルはすべて「assets/sounds/」フォルダ内に配置されている前提です。
const ALARM_SOUND_POOL = [
    require('../../assets/sounds/B0.mp3'),
    require('../../assets/sounds/B1.mp3'),
    require('../../assets/sounds/B2.mp3'),
    require('../../assets/sounds/B3.mp3'),
    require('../../assets/sounds/B4.mp3'),
    require('../../assets/sounds/B5.mp3'),
    require('../../assets/sounds/B6.mp3'),
    require('../../assets/sounds/B7.mp3'),
    require('../../assets/sounds/B8.mp3'),
    require('../../assets/sounds/B9.mp3'),
    require('../../assets/sounds/B10.mp3'),
    require('../../assets/sounds/B11.mp3'),
    require('../../assets/sounds/B12.mp3'),
    require('../../assets/sounds/B13.mp3'),
    require('../../assets/sounds/B14.mp3'),
    require('../../assets/sounds/B15.mp3'),
    require('../../assets/sounds/B16.mp3'),
    require('../../assets/sounds/B17.mp3'),
    require('../../assets/sounds/B18.mp3'),
    require('../../assets/sounds/B19.mp3'),
    require('../../assets/sounds/B20.mp3'),
    require('../../assets/sounds/B21.mp3'),
    require('../../assets/sounds/B22.mp3'),
    require('../../assets/sounds/B23.mp3'),
    require('../../assets/sounds/B24.mp3'),
    require('../../assets/sounds/B25.mp3'),
    require('../../assets/sounds/B26.mp3'),
    require('../../assets/sounds/B27.mp3'),
    require('../../assets/sounds/B28.mp3'),
    require('../../assets/sounds/B29.mp3'),
    require('../../assets/sounds/B30.mp3'),
    require('../../assets/sounds/B31.mp3'),
    require('../../assets/sounds/B32.mp3'),
    require('../../assets/sounds/B33.mp3'),
    require('../../assets/sounds/B34.mp3'),
    require('../../assets/sounds/B35.mp3'),
    require('../../assets/sounds/B36.mp3'),
    require('../../assets/sounds/B37.mp3'),
    require('../../assets/sounds/B38.mp3'),
    require('../../assets/sounds/B39.mp3'),
];

export default function HomeScreen() {
    const router = useRouter();
    const [status, setStatus] = useState<'idle' | 'ringing' | 'matching'>('idle'); /* 備考：アプリの現在のステータス管理 */
    const [sound, setSound] = useState<Audio.Sound | null>(null);                  /* 備考：再生中の音声オブジェクトを保持 */
    const [playedTrackName, setPlayedTrackName] = useState<string>('');            /* 備考：現在再生中のファイル名表示用 */

    // 🔄 コンポーネントのアンマウント時、または音声の切り替わり時にリソースを解放する
    useEffect(() => {
        return () => {
            if (sound) {
                sound.unloadAsync(); /* 備考：メモリリークを防ぐための重要なクリーンアップ処理 */
            }
        };
    }, [sound]);

    // 🔊 40個のプールからランダムに1つ選んでアラーム音を再生する関数
    async function playAlarmSound() {
        try {
            // 既に再生中の音声があれば停止して解放
            if (sound) {
                await sound.stopAsync();
                await sound.unloadAsync();
            }

            console.log('🎵 アラーム音の抽選と読み込みを開始します...');

            // 1. 0〜39の範囲でランダムなインデックスを生成
            const randomIndex = Math.floor(Math.random() * ALARM_SOUND_POOL.length);
            const selectedSoundAsset = ALARM_SOUND_POOL[randomIndex];
            setPlayedTrackName(`B${randomIndex}.mp3`); /* 备注：画面表示用にファイル名を保存 */

            // 2. オーディオのグローバルモード設定（マナーモードでも音が鳴るように設定）
            await Audio.setAudioModeAsync({
                playsInSilentModeIOS: true,
                staysActiveInBackground: true,
                shouldRoutetoSpeakerOnWeb: true,
            });

            // 3. 選択された音声のロード
            const { sound: playbackObject } = await Audio.Sound.createAsync(
                selectedSoundAsset,
                { shouldPlay: false }
            );

            setSound(playbackObject);

            // 4. ループ再生を有効化して再生開始
            await playbackObject.setIsLoopingAsync(true); /* 備考：ユーザーが起きるまで無限ループ */
            await playbackObject.playAsync();

            console.log(`Successfully played: B${randomIndex}.mp3`);
        } catch (error) {
            console.error('❌ 音声の再生に失敗しました:', error);
            Alert.alert('エラー', 'アラーム音の再生に失敗しました。ファイルがassets/sounds/内に正しく配置されているか確認してください。');
        }
    }

    // 🔇 アラーム音を停止してリソースを解放する関数
    async function stopAlarmSound() {
        try {
            if (sound) {
                await sound.stopAsync();
                await sound.unloadAsync();
                setSound(null);
                setPlayedTrackName('');
                console.log('🎵 音声を停止し、リソースを解放しました。');
            }
        } catch (error) {
            console.error('❌ 音声の停止に失敗しました:', error);
        }
    }

    // ⏱️ テスト用：ボタンを押してから5秒後にアラームを作動させる
    function startTestTimer() {
        setStatus('idle');
        Alert.alert('テスト起動', '5秒後に40ファイルの中からランダムに1つが再生されます。');
        setTimeout(() => {
            setStatus('ringing');
            playAlarmSound();
        }, 5000);
    }

    // 🏃‍♂️ 起床ボタンを押した時の処理（音を止めてマッチング状態へ）
    function handleWakeUp() {
        stopAlarmSound();
        setStatus('matching');
        /* 備考：ここに次の画面への遷移ロジック（例: router.push('/matching') などを将来実装） */
    }

    return (
        <SafeAreaView style={styles.container}>
            <View style={styles.header}>
                <Text style={styles.title}>WakeUpApp ⏰</Text>
            </View>

            <View style={styles.content}>
                {/* 1. 待機状態 (idle) */}
                {status === 'idle' && (
                    <View style={styles.card}>
                        <Text style={styles.statusText}>アラーム待機中</Text>
                        <TouchableOpacity style={styles.button} onPress={startTestTimer}>
                            <Text style={styles.buttonText}>5秒後に作動（テスト用）</Text>
                        </TouchableOpacity>
                    </View>
                )}

                {/* 2. 鸣动状態 (ringing) */}
                {status === 'ringing' && (
                    <View style={[styles.card, styles.ringingCard]}>
                        <Text style={styles.ringingText}>⏰ 朝です！起きてください！</Text>
                        {playedTrackName ? (
                            <Text style={styles.subText}>再生中の鈴音: {playedTrackName} (1/40抽選)</Text>
                        ) : null}
                        <TouchableOpacity style={[styles.button, styles.stopButton]} onPress={handleWakeUp}>
                            <Text style={styles.buttonText}>起きた！（マッチングへ）</Text>
                        </TouchableOpacity>
                    </View>
                )}

                {/* 3. マッチング状態 (matching) */}
                {status === 'matching' && (
                    <View style={[styles.card, styles.matchingCard]}>
                        <Text style={styles.statusText}>🤝 誰かとマッチング中...</Text>
                        <TouchableOpacity style={[styles.button, styles.cancelButton]} onPress={() => setStatus('idle')}>
                            <Text style={styles.buttonText}>キャンセル</Text>
                        </TouchableOpacity>
                    </View>
                )}
            </View>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#F9FAFB',
    },
    header: {
        padding: 20,
        alignItems: 'center',
        borderBottomWidth: 1,
        borderBottomColor: '#E5E7EB',
    },
    title: {
        fontSize: 24,
        fontWeight: 'bold',
        color: '#111827',
    },
    content: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 20,
    },
    card: {
        width: '100%',
        backgroundColor: '#FFFFFF',
        borderRadius: 16,
        padding: 24,
        alignItems: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 3,
    },
    ringingCard: {
        backgroundColor: '#FEF2F2',
        borderColor: '#EF4444',
        borderWidth: 2,
    },
    matchingCard: {
        backgroundColor: '#EFF6FF',
    },
    statusText: {
        fontSize: 20,
        fontWeight: '600',
        color: '#374151',
        marginBottom: 20,
    },
    ringingText: {
        fontSize: 22,
        fontWeight: 'bold',
        color: '#DC2626',
        textAlign: 'center',
        marginBottom: 10,
    },
    subText: {
        fontSize: 14,
        color: '#6B7280',
        marginBottom: 24,
        fontWeight: '500',
    },
    button: {
        backgroundColor: '#3B82F6',
        paddingVertical: 14,
        paddingHorizontal: 28,
        borderRadius: 12,
        width: '100%',
        alignItems: 'center',
    },
    buttonText: {
        color: '#FFFFFF',
        fontSize: 16,
        fontWeight: 'bold',
    },
    stopButton: {
        backgroundColor: '#10B981',
    },
    cancelButton: {
        backgroundColor: '#6B7280',
    },
});