# AR自動化システム

30人分のマーカー画像から.mindファイルとGLBモデルを一括生成するシステムです。

## 🚀 クイックスタート

### 1. サーバーを起動

```bash
npm install  # 初回のみ
npm start
```

サーバーが起動すると以下のメッセージが表示されます：
```
🚀 AR Automation Server running at http://localhost:3000
📁 Open http://localhost:3000/ar-automation.html to start
```

### 2. ブラウザでアクセス

ブラウザで以下のURLを開きます：
```
http://localhost:3000/ar-automation.html
```

### 3. データ入力

#### 方法1: CSVインポート（推奨）

1. **CSVファイルを準備**

```csv
activityName,image1,image2,image3,marker1,marker2,marker3
活動名1,画像1のURL,画像2のURL,画像3のURL,マーカー1のURL,マーカー2のURL,マーカー3のURL
活動名2,画像1のURL,画像2のURL,画像3のURL,マーカー1のURL,マーカー2のURL,マーカー3のURL
...
```

2. **Googleスプレッドシートからエクスポート**
   - スプレッドシートで上記の形式で作成
   - 「ファイル」→「ダウンロード」→「カンマ区切り形式(.csv)」

3. **CSVをアップロード**
   - 「📄 CSVファイルを選択」ボタンをクリック
   - 画像が自動的にダウンロードされます

#### 方法2: 手動入力

1. **活動名**: 各行に活動名を入力
2. **画像1〜3**: GLBに変換される画像ファイルを選択
3. **マーカー1〜3**: .mindファイル生成に使用される画像を選択

### 4. 処理実行

「🚀 一括処理を開始」ボタンをクリックすると、以下の処理が自動で行われます：

1. 画像1〜3をGLBファイルに変換
2. マーカー画像1〜3から.mindファイルを生成
3. targets-{活動名}.jsonを生成
4. すべてのファイルを1つのZIPにまとめてダウンロード

## 📦 出力ファイル構造

```
ar_output.zip
├── 活動名1/
│   ├── image1.glb
│   ├── image2.glb
│   ├── image3.glb
│   ├── 活動名1.mind
│   └── targets-活動名1.json
├── 活動名2/
│   ├── image1.glb
│   ├── image2.glb
│   ├── image3.glb
│   ├── 活動名2.mind
│   └── targets-活動名2.json
...
└── 活動名30/
    ├── image1.glb
    ├── image2.glb
    ├── image3.glb
    ├── 活動名30.mind
    └── targets-活動名30.json
```

## ⚙️ 技術仕様

### フロントエンド（ブラウザ）
- **GLB変換**: @gltf-transform/core を使用して画像を3D平面メッシュに変換
- **.mind生成**: MindAR Compilerを使用してマーカー画像から.mindファイルを生成
- **ZIP作成**: fflateライブラリでクライアント側でZIPファイルを生成

### バックエンド（Node.js）
- **Express**: 静的ファイル配信のみ（現在はブラウザ完結型のため使用していません）

### 処理フロー

```
[ブラウザ]
  ├─ 画像アップロード
  ├─ GLB変換 (ブラウザ内)
  ├─ .mind生成 (ブラウザ内)
  ├─ ZIP作成 (ブラウザ内)
  └─ ダウンロード
```

## 🔧 カスタマイズ

### 人数を変更する場合

`ar-automation.html` の以下の行を編集：

```javascript
const NUM_PEOPLE = 30;  // ここを変更
```

### GLBのサイズを変更する場合

`ar-automation.html` の `imageToGlb` 呼び出し部分：

```javascript
const glbBuffer = await imageToGlb(imageFile, {
  longSide: 1.0,      // 長辺のサイズ（メートル単位）
  doubleSided: true   // 両面表示
});
```

## 📝 注意事項

1. **初回ロード**: ブラウザで初めて開いた際、必要なライブラリ（gltf-transform, fflate, mind-ar）のダウンロードに時間がかかります
2. **ブラウザメモリ**: 大量の画像を処理する場合、ブラウザのメモリを消費します。30人×6枚=180枚程度は問題ありません
3. **ファイルサイズ**: 各画像ファイルは10MB以下を推奨します
4. **対応ブラウザ**: Chrome、Edge、Firefox等のモダンブラウザ（IE非対応）
5. **Googleドライブの共有設定**: CSVでGoogleドライブのURLを使用する場合、「リンクを知っている全員」に共有設定を変更してください

## 🔗 GoogleドライブURL対応

以下の形式のGoogleドライブURLに対応しています：

- `https://drive.google.com/file/d/FILE_ID/view`
- `https://drive.google.com/open?id=FILE_ID`

これらは自動的にダウンロード可能なURLに変換されます。

**重要**: Googleドライブの画像は「リンクを知っている全員」に共有設定してください。

## 🐛 トラブルシューティング

### サーバーが起動しない
```bash
# ポート3000が使用中の場合、server.jsのPORT変数を変更
const PORT = 3000;  // → 別のポート番号に変更
```

### ライブラリの読み込みに失敗
- インターネット接続を確認してください
- CDN（esm.sh, cdn.jsdelivr.net）にアクセスできることを確認

### .mindファイルが生成されない
- マーカー画像が適切な画像ファイル（PNG/JPG）であることを確認
- コンソール（F12）でエラーメッセージを確認

### CSVインポートで画像がダウンロードできない
- Googleドライブの共有設定を確認（「リンクを知っている全員」に設定）
- URLが正しいか確認
- CORS制限により一部のURLはダウンロードできない場合があります
- その場合は手動でファイルをダウンロードして、方法2（手動入力）を使用してください

## 📄 ライセンス

このプロジェクトはMITライセンスです。

## 🙏 使用ライブラリ

- [MindAR](https://github.com/hiukim/mind-ar-js) - ARマーカー認識
- [gltf-transform](https://github.com/donmccurdy/glTF-Transform) - GLB生成
- [fflate](https://github.com/101arrowz/fflate) - ZIP圧縮
- [Express](https://expressjs.com/) - Webサーバー
