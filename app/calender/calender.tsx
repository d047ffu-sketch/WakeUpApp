import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    Alert,
    Modal,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const STORAGE_KEY = '@wakeupapp:calendarTodos';
const STORAGE_KEY_WAKE_DATES = '@wakeupapp:wakeDates';
const STORAGE_KEY_STREAK = '@wakeupapp:alarmStreak';
const STORAGE_KEY_STREAK_DATE = '@wakeupapp:alarmStreakDate';

type TodoItem = {
  id: string;
  title: string;
  startDate: string;
  endDate: string;
  completed: boolean;
};

function toDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseDateKey(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function formatDisplayDate(value: string): string {
  const date = parseDateKey(value);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function isSameDay(left: string, right: string): boolean {
  return left === right;
}

function isTaskOnDate(task: TodoItem, targetDate: string): boolean {
  return targetDate >= task.startDate && targetDate <= task.endDate;
}

function buildMonthDays(anchorDate: string): (string | null)[] {
  const baseDate = parseDateKey(anchorDate);
  const year = baseDate.getFullYear();
  const month = baseDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const days: (string | null)[] = [];

  const leadingDays = (firstDay.getDay() + 6) % 7;
  for (let index = 0; index < leadingDays; index += 1) {
    days.push(null);
  }

  for (let day = 1; day <= lastDay.getDate(); day += 1) {
    const current = new Date(year, month, day);
    days.push(toDateKey(current));
  }

  while (days.length % 7 !== 0) {
    days.push(null);
  }

  return days;
}

export default function CalendarScreen() {
  const router = useRouter();
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [selectedDate, setSelectedDate] = useState(() => toDateKey(new Date()));
  const [draftTitle, setDraftTitle] = useState('');
  const [startDate, setStartDate] = useState(() => toDateKey(new Date()));
  const [endDate, setEndDate] = useState(() => toDateKey(new Date()));
  const [datePickerTarget, setDatePickerTarget] = useState<'start' | 'end' | null>(null);
  const [editingTodoDate, setEditingTodoDate] = useState<{ todoId: string; field: 'startDate' | 'endDate' } | null>(null);
  const [isCalendarExpanded, setIsCalendarExpanded] = useState(false);
  const [wakeDates, setWakeDates] = useState<string[]>([]);
  const [streakCount, setStreakCount] = useState(0);

  const loadTodos = useCallback(async () => {
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      if (!stored) return;
      const parsed = JSON.parse(stored) as TodoItem[];
      setTodos(parsed);
    } catch (error) {
      console.warn('Todo の読み込みに失敗しました', error);
    }
  }, []);

  const saveTodos = useCallback(async (nextTodos: TodoItem[]) => {
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(nextTodos));
    } catch (error) {
      console.warn('Todo の保存に失敗しました', error);
    }
  }, []);

  const loadWakeData = useCallback(async () => {
    try {
      const storedWakeDates = await AsyncStorage.getItem(STORAGE_KEY_WAKE_DATES);
      if (storedWakeDates) {
        setWakeDates(JSON.parse(storedWakeDates) as string[]);
      } else {
        setWakeDates([]);
      }

      const savedStreak = await AsyncStorage.getItem(STORAGE_KEY_STREAK);
      const savedDate = await AsyncStorage.getItem(STORAGE_KEY_STREAK_DATE);
      if (savedStreak) {
        setStreakCount(Number(savedStreak));
      } else {
        setStreakCount(savedDate ? 1 : 0);
      }
    } catch (error) {
      console.warn('起床データの読み込みに失敗しました', error);
    }
  }, []);

  useEffect(() => {
    void loadTodos();
    void loadWakeData();
  }, [loadTodos, loadWakeData]);

  useFocusEffect(
    useCallback(() => {
      void loadTodos();
      void loadWakeData();
      return () => undefined;
    }, [loadTodos, loadWakeData]),
  );

  const monthDays = useMemo(() => buildMonthDays(selectedDate), [selectedDate]);
  const todayKey = toDateKey(new Date());
  const isSelectedDateMissed = selectedDate < todayKey && !wakeDates.includes(selectedDate);
  const visibleTodos = useMemo(
    () => todos.filter((todo) => isTaskOnDate(todo, selectedDate)),
    [selectedDate, todos],
  );
  const groupedTodos = useMemo(() => {
    const grouped: TodoItem[][] = [];
    visibleTodos.forEach((todo) => {
      const sameTitleGroup = grouped.find((group) => group.some((item) => item.title === todo.title));
      if (sameTitleGroup) {
        sameTitleGroup.push(todo);
      } else {
        grouped.push([todo]);
      }
    });
    return grouped;
  }, [visibleTodos]);

  const handleAddTodo = async () => {
    const title = draftTitle.trim();
    if (!title) {
      Alert.alert('タイトルを入力してください');
      return;
    }
    if (startDate > endDate) {
      Alert.alert('終了日は開始日以降にしてください');
      return;
    }

    const nextTodo: TodoItem = {
      id: `${Date.now()}`,
      title,
      startDate,
      endDate,
      completed: false,
    };

    const nextTodos = [nextTodo, ...todos].sort((left, right) => left.startDate.localeCompare(right.startDate));
    setTodos(nextTodos);
    await saveTodos(nextTodos);
    setDraftTitle('');
    setSelectedDate(startDate);
    setStartDate(startDate);
    setEndDate(endDate);
  };

  const toggleTodo = async (id: string) => {
    const nextTodos = todos.map((todo) =>
      todo.id === id ? { ...todo, completed: !todo.completed } : todo,
    );
    setTodos(nextTodos);
    await saveTodos(nextTodos);
  };

  const updateTodoDate = async (id: string, field: 'startDate' | 'endDate', nextValue: string) => {
    const nextTodos = todos.map((todo) => {
      if (todo.id !== id) return todo;
      if (field === 'startDate') {
        return {
          ...todo,
          startDate: nextValue > todo.endDate ? todo.endDate : nextValue,
          endDate: nextValue > todo.endDate ? nextValue : todo.endDate,
        };
      }
      return {
        ...todo,
        endDate: nextValue < todo.startDate ? todo.startDate : nextValue,
        startDate: nextValue < todo.startDate ? nextValue : todo.startDate,
      };
    });
    setTodos(nextTodos);
    await saveTodos(nextTodos);
  };

  const onDateChange = (event: DateTimePickerEvent, pickedDate?: Date) => {
    if (event.type !== 'set' || !pickedDate) {
      setDatePickerTarget(null);
      setEditingTodoDate(null);
      return;
    }

    const nextValue = toDateKey(pickedDate);

    if (editingTodoDate) {
      void updateTodoDate(editingTodoDate.todoId, editingTodoDate.field, nextValue);
      setEditingTodoDate(null);
      return;
    }

    if (datePickerTarget === 'start') {
      setStartDate(nextValue);
      if (nextValue > endDate) {
        setEndDate(nextValue);
      }
    } else if (datePickerTarget === 'end') {
      setEndDate(nextValue);
      if (nextValue < startDate) {
        setStartDate(nextValue);
      }
    }

    setDatePickerTarget(null);
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#1D3D47" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>カレンダー</Text>
        <View style={styles.backButton} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>予定を見る</Text>
            <TouchableOpacity
              onPress={() => {
                if (!isSelectedDateMissed) {
                  setIsCalendarExpanded(true);
                }
              }}>
              <Text style={[styles.cardCaption, isSelectedDateMissed && styles.cardCaptionDisabled]}>拡大</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.streakBanner}>
            <Text style={styles.streakLabel}>連続起床</Text>
            <Text style={styles.streakValue}>{streakCount}日</Text>
          </View>

          <View style={styles.weekRow}>
            {['月', '火', '水', '木', '金', '土', '日'].map((label) => (
              <Text key={label} style={styles.weekLabel}>
                {label}
              </Text>
            ))}
          </View>

          <View style={styles.calendarGrid}>
            {monthDays.map((dayKey, index) => {
              if (!dayKey) {
                return <View key={`empty-${index}`} style={styles.dayCell} />;
              }

              const dayTasks = todos.filter((todo) => isTaskOnDate(todo, dayKey));
              const isSelected = isSameDay(dayKey, selectedDate);
              const isWoke = wakeDates.includes(dayKey);
              const isMissed = dayKey < todayKey && !isWoke;

              return (
                <TouchableOpacity
                  key={dayKey}
                  style={[
                    styles.dayCell,
                    isSelected && styles.dayCellSelected,
                    isWoke && styles.dayCellWoke,
                    isMissed && styles.dayCellMissed,
                  ]}
                  onPress={() => {
                    if (isMissed) {
                      return;
                    }
                    setSelectedDate(dayKey);
                    setIsCalendarExpanded(true);
                  }}>
                  <Text
                    style={[
                      styles.dayNumber,
                      isSelected && styles.dayNumberSelected,
                      isWoke && styles.dayNumberOnWoke,
                      isMissed && styles.dayNumberOnMissed,
                    ]}>
                    {parseDateKey(dayKey).getDate()}
                  </Text>
                  {!isMissed && dayTasks.slice(0, 2).map((todo) => (
                    <Text
                      key={todo.id}
                      style={[(isWoke || isMissed) && styles.dayTaskLabelOnDark, styles.dayTaskLabel]}
                      numberOfLines={1}>
                      {todo.completed ? '✓' : '•'} {todo.title}
                    </Text>
                  ))}
                  {!isMissed && dayTasks.length > 2 ? (
                    <Text style={[(isWoke || isMissed) && styles.dayTaskLabelOnDark, styles.dayTaskHint]}>
                      +{dayTasks.length - 2}
                    </Text>
                  ) : null}
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Todo を追加</Text>
          {isSelectedDateMissed ? (
            <Text style={styles.lockedNotice}>この日は Todo を設定できません。</Text>
          ) : (
            <>
              <TextInput
                style={styles.input}
                value={draftTitle}
                onChangeText={setDraftTitle}
                placeholder="例：朝の散歩"
                placeholderTextColor="#97A4A8"
              />

              <View style={styles.dateRow}>
                <TouchableOpacity style={styles.dateButton} onPress={() => setDatePickerTarget('start')}>
                  <Text style={styles.dateButtonLabel}>開始日</Text>
                  <Text style={styles.dateButtonValue}>{formatDisplayDate(startDate)}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.dateButton} onPress={() => setDatePickerTarget('end')}>
                  <Text style={styles.dateButtonLabel}>終了日</Text>
                  <Text style={styles.dateButtonValue}>{formatDisplayDate(endDate)}</Text>
                </TouchableOpacity>
              </View>

              {datePickerTarget || editingTodoDate ? (
                <DateTimePicker
                  value={
                    editingTodoDate
                      ? parseDateKey(
                          todos.find((todo) => todo.id === editingTodoDate.todoId)?.[
                            editingTodoDate.field
                          ] ?? startDate,
                        )
                      : parseDateKey(datePickerTarget === 'start' ? startDate : endDate)
                  }
                  mode="date"
                  display="default"
                  onChange={onDateChange}
                />
              ) : null}

              <TouchableOpacity style={styles.addButton} onPress={() => void handleAddTodo()}>
                <Text style={styles.addButtonText}>Todo を追加</Text>
              </TouchableOpacity>
            </>
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>{formatDisplayDate(selectedDate)} の Todo</Text>
          {isSelectedDateMissed ? (
            <Text style={styles.lockedNotice}>この日には Todo を表示できません。</Text>
          ) : visibleTodos.length === 0 ? (
            <Text style={styles.emptyText}>この日に入っている Todo はまだありません。</Text>
          ) : (
            groupedTodos.map((group, groupIndex) => (
              <View key={`group-${groupIndex}`} style={styles.todoGroup}>
                {group.map((todo) => (
                  <View key={todo.id} style={styles.todoRow}>
                    <TouchableOpacity
                      style={[styles.checkbox, todo.completed && styles.checkboxDone]}
                      onPress={() => void toggleTodo(todo.id)}>
                      {todo.completed ? <Ionicons name="checkmark" size={14} color="#fff" /> : null}
                    </TouchableOpacity>
                    <View style={styles.todoTextWrap}>
                      <Text style={[styles.todoTitle, todo.completed && styles.todoTitleDone]}>
                        {todo.title}
                      </Text>
                      <View style={styles.dateEditRow}>
                        <TouchableOpacity
                          style={styles.dateEditButton}
                          onPress={() => {
                            setEditingTodoDate({ todoId: todo.id, field: 'startDate' });
                            setDatePickerTarget(null);
                          }}>
                          <Text style={styles.dateEditLabel}>開始</Text>
                          <Text style={styles.dateEditValue}>{formatDisplayDate(todo.startDate)}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.dateEditButton}
                          onPress={() => {
                            setEditingTodoDate({ todoId: todo.id, field: 'endDate' });
                            setDatePickerTarget(null);
                          }}>
                          <Text style={styles.dateEditLabel}>終了</Text>
                          <Text style={styles.dateEditValue}>{formatDisplayDate(todo.endDate)}</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  </View>
                ))}
              </View>
            ))
          )}
        </View>
      </ScrollView>

      <Modal visible={isCalendarExpanded} transparent animationType="fade" onRequestClose={() => setIsCalendarExpanded(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>カレンダー拡大表示</Text>
              <TouchableOpacity onPress={() => setIsCalendarExpanded(false)}>
                <Ionicons name="close" size={22} color="#1D3D47" />
              </TouchableOpacity>
            </View>
            <View style={styles.expandedCalendarBox}>
              <Text style={styles.expandedCalendarTitle}>{selectedDate}</Text>
              {visibleTodos.length === 0 ? (
                <Text style={styles.expandedEmptyText}>この日には Todo がありません。</Text>
              ) : (
                <View style={styles.expandedTodoList}>
                  {visibleTodos.map((todo) => (
                    <View key={todo.id} style={styles.expandedTodoCard}>
                      <Text style={[styles.expandedTodoTitle, todo.completed && styles.todoTitleDone]}>
                        {todo.title}
                      </Text>
                      <Text style={styles.expandedTodoDate}>
                        {formatDisplayDate(todo.startDate)} 〜 {formatDisplayDate(todo.endDate)}
                      </Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f2f4f5',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1D3D47',
  },
  content: {
    padding: 16,
    paddingBottom: 32,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1D3D47',
  },
  cardCaption: {
    fontSize: 12,
    color: '#6B7A80',
  },
  cardCaptionDisabled: {
    color: '#9aa4a8',
  },
  streakBanner: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#1D3D47',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 12,
  },
  streakLabel: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  streakValue: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '800',
  },
  weekRow: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  weekLabel: {
    flex: 1,
    textAlign: 'center',
    fontSize: 12,
    color: '#6B7A80',
    fontWeight: '600',
  },
  calendarGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  dayCell: {
    width: '14.2857%',
    minHeight: 74,
    padding: 6,
    borderRadius: 10,
    backgroundColor: '#f7f9fa',
    marginBottom: 8,
    marginRight: '0.0%',
  },
  dayCellSelected: {
    backgroundColor: '#dfe9ec',
  },
  dayCellWoke: {
    backgroundColor: '#2f8f5b',
  },
  dayCellMissed: {
    backgroundColor: '#111111',
  },
  dayNumber: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1D3D47',
    marginBottom: 4,
  },
  dayNumberSelected: {
    color: '#0f5d68',
  },
  dayNumberOnWoke: {
    color: '#ffffff',
  },
  dayNumberOnMissed: {
    color: '#ffffff',
  },
  dayTaskLabel: {
    fontSize: 10,
    color: '#5e6b70',
  },
  dayTaskLabelOnDark: {
    color: '#f5f7f8',
  },
  dayTaskHint: {
    fontSize: 10,
    color: '#88a0a5',
    marginTop: 2,
  },
  input: {
    borderWidth: 1,
    borderColor: '#dfe7e9',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 8,
    marginBottom: 12,
    color: '#1D3D47',
  },
  dateRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  dateButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#dfe7e9',
    borderRadius: 12,
    padding: 10,
    backgroundColor: '#fafcfc',
  },
  dateButtonLabel: {
    fontSize: 12,
    color: '#6B7A80',
  },
  dateButtonValue: {
    marginTop: 4,
    fontSize: 14,
    color: '#1D3D47',
    fontWeight: '600',
  },
  addButton: {
    backgroundColor: '#1D3D47',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  addButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  emptyText: {
    marginTop: 8,
    color: '#7b8a8f',
    fontSize: 13,
  },
  lockedNotice: {
    marginTop: 8,
    color: '#8b8b8b',
    fontSize: 13,
    fontWeight: '600',
  },
  todoGroup: {
    borderTopWidth: 1,
    borderTopColor: '#f0f3f4',
    marginTop: 8,
    paddingTop: 8,
  },
  todoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: '#f8fbfc',
    paddingHorizontal: 10,
    marginBottom: 8,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: '#7AA5AB',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
    marginTop: 2,
  },
  checkboxDone: {
    backgroundColor: '#7AA5AB',
  },
  todoTextWrap: {
    flex: 1,
  },
  todoTitle: {
    fontSize: 14,
    color: '#1D3D47',
    fontWeight: '600',
  },
  todoTitleDone: {
    color: '#98A5A8',
    textDecorationLine: 'line-through',
    opacity: 0.7,
  },
  todoRange: {
    marginTop: 2,
    fontSize: 12,
    color: '#6B7A80',
  },
  dateEditRow: {
    flexDirection: 'row',
    marginTop: 8,
    gap: 8,
  },
  dateEditButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#dfe7e9',
    borderRadius: 10,
    padding: 8,
    backgroundColor: '#fafcfc',
  },
  dateEditLabel: {
    fontSize: 11,
    color: '#6B7A80',
  },
  dateEditValue: {
    marginTop: 2,
    fontSize: 13,
    color: '#1D3D47',
    fontWeight: '600',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(13, 33, 39, 0.43)',
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 20,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1D3D47',
  },
  expandedCalendarBox: {
    backgroundColor: '#f6f8f9',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
  },
  expandedCalendarTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1D3D47',
    marginBottom: 6,
  },
  expandedCalendarText: {
    fontSize: 13,
    color: '#6B7A80',
    textAlign: 'center',
  },
  expandedEmptyText: {
    marginTop: 12,
    fontSize: 13,
    color: '#7b8a8f',
  },
  expandedTodoList: {
    width: '100%',
    marginTop: 12,
    gap: 8,
  },
  expandedTodoCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#e7ecef',
  },
  expandedTodoTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1D3D47',
  },
  expandedTodoDate: {
    marginTop: 4,
    fontSize: 12,
    color: '#6B7A80',
  },
});
