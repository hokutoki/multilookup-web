# MultiLookup Web

iPhone/iPadで使える串刺し検索PWAです。

## 機能

- 入力した言葉を複数の検索先へ展開
- Google検索、Google画像検索、Wikipedia日本語、Weblio、物書堂などの初期検索先
- 検索先ON/OFF
- 検索先の並び替え
- 検索履歴保存
- JSONエクスポート/インポート
- ホーム画面に追加できるPWA manifest
- Service Workerによる静的ファイルキャッシュ

## 起動

```sh
cd /Users/taka/Desktop/codex/multilookup_web
python3 -m http.server 8787
```

ブラウザで開く:

```text
http://127.0.0.1:8787/
```

## iPhone/iPadで使う方法

同じネットワークからMacのIPアドレスで開き、Safariの共有メニューから「ホーム画面に追加」を選びます。

## iCloudについて

WebアプリはネイティブiOSアプリのiCloud KVSを直接利用できません。代替として、設定JSONを書き出してiCloud Driveに保存し、別端末で読み込む運用にしています。
