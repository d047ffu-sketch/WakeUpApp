// Firebase の初期化ファイル
// auth（ログイン認証）と db（Firestore データベース）をアプリ全体で使えるように書き出す。

import AsyncStorage from "@react-native-async-storage/async-storage";
import { getApp, getApps, initializeApp } from "firebase/app";
import { getReactNativePersistence, initializeAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// .env から読み込む Firebase の設定値（EXPO_PUBLIC_ で始まる変数はアプリ側で読める）
const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};

// アプリの初期化。
// Fast Refresh（保存して即反映）で何度も実行されると二重初期化エラーになるため、
// すでに初期化済みなら既存のものを使い回す。
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

// 認証（auth）の初期化。
// React Native ではログイン状態をアプリ再起動後も保持するために
// AsyncStorage（端末内のストレージ）を使う必要がある。
// こちらも Fast Refresh で二重初期化されると例外が出るので try / catch で守る。
/** @type {import('firebase/auth').Auth} */
let auth;
try {
  auth = initializeAuth(app, {
    persistence: getReactNativePersistence(AsyncStorage),
  });
} catch (e) {
  // すでに初期化済みの場合はここに来る。既存の auth を取り出して使う。
  const { getAuth } = require("firebase/auth");
  auth = getAuth(app);
}

// Firestore（データベース）の初期化
const db = getFirestore(app);

export { auth, db };
