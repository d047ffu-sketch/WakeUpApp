// ログイン中のユーザー情報を、アプリのどの画面からでも参照できるようにする仕組み。
// React の Context（コンテキスト）という機能を使って、ログイン状態を共有する。

import { onAuthStateChanged, type User } from "firebase/auth";
import { createContext, useContext, useEffect, useState } from "react";
import { auth } from "../firebase";

// Context で共有する中身の型。
type AuthContextType = {
  user: User | null; // ログイン中のユーザー。未ログインなら null
  initializing: boolean; // 起動直後にログイン状態を確認している間は true
};

// Context の本体を作成（初期値）。
const AuthContext = createContext<AuthContextType>({
  user: null,
  initializing: true,
});

// アプリ全体を包んで、ログイン状態を配るためのコンポーネント。
// app/_layout.tsx でこの <AuthProvider> を一番外側に置く。
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [initializing, setInitializing] = useState(true);

  useEffect(() => {
    // Firebase のログイン状態の変化を監視する。
    // ログイン・ログアウト・起動時の自動ログインなど、状態が変わるたびに呼ばれる。
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setInitializing(false); // 一度確認できたら初期化完了
    });

    // 画面が消えるときに監視を解除する（メモリリーク防止）。
    return unsubscribe;
  }, []);

  return (
    <AuthContext.Provider value={{ user, initializing }}>
      {children}
    </AuthContext.Provider>
  );
}

// 各画面から「useAuth()」と書くだけでログイン状態を取り出せる便利関数。
export function useAuth() {
  return useContext(AuthContext);
}
