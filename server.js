/* ─────────────── 依存＆初期化 ─────────────── */
require("dotenv").config();
const express  = require("express");
const bodyParser = require("body-parser");
const cors     = require("cors");
const session  = require("express-session");
const path     = require("path");
const axios    = require("axios");

const admin    = require("firebase-admin");
const serviceAccount = require("./serviceAccountKey.json");
const { OAuth2Client } = require("google-auth-library");

/* ── .env ───────────────────────────────────── */
const GEMINI_API_KEY   = process.env.GEMINI_API_KEY;
const GEMINI_ENDPOINT  = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;
const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY;            // Auth REST
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_CALLBACK  = process.env.GOOGLE_OAUTH_CALLBACK_URL || "http://localhost:8080/auth/google/callback";
const PORT             = process.env.PORT || 8080;

/* ─── Firebase Admin ────────────────────────── */
admin.initializeApp({
  credential : admin.credential.cert(serviceAccount),
  databaseURL: "https://aquatutoraitrial-976af-default-rtdb.asia-southeast1.firebasedatabase.app"
});
const firestore = admin.firestore();

/* ─── Express 基本設定 ──────────────────────── */
const app = express();
app.use(bodyParser.json());
app.use(cors());
app.use(express.static(path.join(__dirname,"public")));
app.use(session({
  secret:"aqua-secret", resave:false, saveUninitialized:false,
}));

/* ─── 文面定数 ──────────────────────────────── */
const systemPrompt =  `
AquaTutorAIは、営業会社の営業マンを育成するためのカスタムGPTです。
以下の指示に従って、効果的なトレーニングを提供します。
最初に①～④を選択させる

①商品知識の習得
営業マンが取り扱うAquaTutorAIとIT導入補助金に関する知識を学びます。
質問の順番を”A.順番””B.ランダム”から選べます。
データベースを参照して、少しづつ”販売に必要な知識”を先に出し、その後それに沿った質問をします。
10問ごとに「終了」または「続ける」を選択できます。
終了後、点数を提示します。

②営業マンの基礎マナー
ビジネスマナーやコミュニケーションスキル、身だしなみなど、営業マンとして必要な基本マナーを学習します。このセクションも10問ごとに「終了」または「続ける」を選択できます。
終了後、点数、フィードバックを提示します。

③売れる営業マンになるための講座
営業手法やクロージング技術、顧客心理など、売上向上につながるスキルを習得します。
このセクションも10問ごとに「終了」または「続ける」を選択できます。

④対面ロールプレイング（B2B）
AquaTutorAIを活用した実践的なロールプレイングを行います。
顧客設定や性格はランダムで提示、業種は実際のビジネスに即して想定。
商談がクローズした時点で終了し、評価とアドバイスを提供して点数化。
称号を授与します。
初級、中級、上級を選択可
例：「稀代の転載営業マン」「駆け出し青春営業マン」など
”初級以外”ロールプレイング中にナビゲーションは不要。

⑤AquaTutorAI導入シミュレーション
A. AquaTutorAI導入シミュレーションを行います。以下の項目を数字で入力してください。：
1. 研修を受ける社員数（人）
2. 1人あたりの研修回数（回/月）
3. 1回の研修時間（時間）
4. 上司・トレーナー・同僚の関与割合（%）
5. 上司・トレーナー・同僚の平均時給（円）
6. 研修付帯コスト/交通費など（円/月）
7. AquaTutorAI導入初期費用（補助金適用前、円）
8. 月額利用料（円/月）
9. 時間削減率（%）

B.上記入力データを使い、AquaTutorAI導入シミュレーションを行い結果を出す。

▼出力内容
1) 現在の研修工数・人件費（月と年）
2) 現在の研修コスト（月と年）
3) 導入後の時間・コスト削減
4) 投資回収期間（ROI）
5) 純削減額（月/年）
6) メリットを提示し背中を軽く押す言葉

▼留意点
- 入力された初期費用が半額、月額費用は50,000円になる前提
- 入力されない数字は一般的な数字で予測
- 削減率は入力された数値（50～70%推奨）
- 結果を簡潔に示し、最後にメリットを提示
- メリットは金額だけでなく、総合的なメリットを提示
例：「アウトプットが増え、質が向上」「空いた時間で営業できる」など

注意事項
・派手な絵文字や煽り文は使用しない。
・事実に基づく知識の提供と進行を行う。
・都度ネット検索を行う。
・本題以外の話題は基本相手にせず、本題に戻ります。
・雑談は必要な場合のみ対応。
`

const MENU_TEXT = `
番号でセクションを選択してください
1. 商品知識の習得
2. 営業マンの基礎マナー
3. 売れる営業マンになるための講座
4. 対面ロールプレイング（B2B）
5. AquaTutorAI導入シミュレーション（※準備中）
`;
const sectionMap = {
  "1":"商品知識の習得",
  "2":"営業マンの基礎マナー",
  "3":"売れる営業マンになるための講座",
};

/* ─── Firestore 質問ユーティリティ ─────────── */
async function loadQuestions(section){
  const snap = await firestore.collection("questions").where("section","==",section).get();
  return snap.docs.map(d=>({id:d.id,...d.data()}));
}
const fmtQ=(q,i)=>`【第${i+1}問】
${q.question_text}
1. ${q.choice_1}
2. ${q.choice_2}
3. ${q.choice_3}
4. ${q.choice_4}
番号で回答してください。`;

/* ──────────────────────────────────────────── */
/*                  チャット API                 */
/* ──────────────────────────────────────────── */
app.post("/api/chat", async (req,res)=>{
  const msg = (req.body.message||"").trim();
  const s   = req.session;

  /* ── 初回 ── */
  if(!s.turnCount){
    Object.assign(s,{
      turnCount:0,
      stage:"menu",                   // menu | quiz | quiz-post | rp-difficulty | rp
      conversationHistory:[{role:"user",content:systemPrompt}]
    });
  }

  /* 全メッセージを履歴へ push */
  if(msg){ s.conversationHistory.push({role:"user",content:msg}); }

  /* ============== MENU ============== */
  if(s.stage==="menu"){
    if(["1","2","3"].includes(msg)){
      const section=sectionMap[msg];
      const qs = await loadQuestions(section);
      if(!qs.length){ s.turnCount++; return res.json({reply:`${section} の問題がありません。\n${MENU_TEXT}`}); }
      Object.assign(s,{stage:"quiz",section,quizIdx:0,quizList:qs});
      const reply=`${section} を開始します。\n\n${fmtQ(qs[0],0)}`;
      s.conversationHistory.push({role:"assistant",content:reply});
      s.turnCount++; return res.json({reply});
    }
    if(msg==="4"){
      s.stage="rp-difficulty";
      const reply="難易度を選んでください。\n1. 初級\n2. 中級\n3. 上級\n（番号で入力）";
      s.conversationHistory.push({role:"assistant",content:reply});
      s.RPsection = "対面ロールプレイング（B2B）";
      s.turnCount++; return res.json({reply});
    }
    if(msg==="5"){ s.turnCount++; return res.json({reply:"シミュレーションは準備中です。\n"+MENU_TEXT}); }
    /* 初期表示 */
    if(!msg){ 
      s.turnCount++; 
      s.conversationHistory.push({role:"assistant",content:MENU_TEXT});
      return res.json({reply:MENU_TEXT}); 
    }

    s.conversationHistory.push({role:"assistant",content:MENU_TEXT});
    s.turnCount++; 
    return res.json({reply:MENU_TEXT});
  }

  /* ============== QUIZ ============== */
  if(s.stage==="quiz"){
    const q = s.quizList[s.quizIdx];
    if(!["1","2","3","4"].includes(msg)){
      s.turnCount++; return res.json({reply:"1〜4 の番号で答えてください。"});
    }

    /* Firestore 保存 */
    const uid=req.session.user?.uid;
    if(uid){
      await firestore.collection("users").doc(uid)
        .collection("user_answers").add({
          question_id:q.id, section:s.section,
          selected_choice:Number(msg),
          correct:Number(msg)===q.correct_choice,
          answer_timestamp:admin.firestore.FieldValue.serverTimestamp()
        });
    }

    const fb = Number(msg)===q.correct_choice ? "⭕ 正解！" : `❌ 不正解！ 正解は ${q.correct_choice}`;
    s.quizIdx++;

    /* 最後の問題？ */
    if(s.quizIdx>=s.quizList.length){
      s.stage="quiz-post";
      const reply=`${fb}\n\n全${s.quizList.length}問終了！\n「続ける」か「終了」を入力してください。`;
      s.conversationHistory.push({role:"assistant",content:reply});
      s.turnCount++; return res.json({reply});
    }

    const reply=`${fb}\n\n${fmtQ(s.quizList[s.quizIdx],s.quizIdx)}`;
    s.conversationHistory.push({role:"assistant",content:reply});
    s.turnCount++; return res.json({reply});
  }

  /* ---- quiz 後 ---- */
  if(s.stage==="quiz-post"){
    if(msg==="続ける"){
      s.stage="quiz"; s.quizIdx=0;
      const reply=`続けていきます。\n\n${fmtQ(s.quizList[0],0)}`;
      s.conversationHistory.push({role:"assistant",content:reply});
      s.turnCount++; return res.json({reply});
    }
    if(msg==="終了"){
      s.stage="menu";
      const reply=`お疲れさまでした！\n${MENU_TEXT}`;
      s.conversationHistory.push({role:"assistant",content:reply});
      s.turnCount++; return res.json({reply});
    }
    s.turnCount++; return res.json({reply:"「続ける」か「終了」を入力してください。"});
  }

  /* ========== RP 難易度選択 ========== */
  if(s.stage==="rp-difficulty"){
    if(!["1","2","3"].includes(msg)){
      s.turnCount++; return res.json({reply:"1〜3 の番号で選択してください"});
    }
    const diff={1:"初級",2:"中級",3:"上級"}[msg];
    Object.assign(s,{stage:"rp",rpDifficulty:diff,rpTurn:0,rpStartAt:Date.now()});
    const reply=`ロールプレイ（${diff}）を開始します。\nあなたは営業マン、私は顧客です。まず挨拶からどうぞ。`;
    s.conversationHistory.push({role:"assistant",content:reply});
    s.turnCount++; return res.json({reply});
  }

  /* ============== RP 本編 ============== */
  if(s.stage==="rp"){
    /* 終了コマンド */
    if(["終了","end","quit"].includes(msg.toLowerCase())){
      s.stage="menu";
      /* roleplay_sessions 保存 */
      const uid=req.session.user?.uid;
      if(uid){
        await firestore.collection("users").doc(uid)
          .collection("roleplay_sessions").add({
            start_timestamp:new Date(s.rpStartAt),
            end_timestamp  :admin.firestore.FieldValue.serverTimestamp(),
            cleared:true,
            difficulty:s.rpDifficulty,
            section:s.RPsection,
          });
      }
      const reply=`ロールプレイを終了しました。お疲れさまです！\n${MENU_TEXT}`;
      s.conversationHistory.push({role:"assistant",content:reply});
      s.turnCount++; return res.json({reply});
    }

    /* Gemini で顧客役の返答生成 */
    try{
      const gemHist=[
        {role:"user",parts:[{text:systemPrompt}]},
        ...s.conversationHistory.map(h=>({role:h.role,parts:[{text:h.content}]})),
        {role:"user",parts:[{text:msg}]}
      ];
      const gRes=await axios.post(GEMINI_ENDPOINT,{contents:gemHist},{headers:{"Content-Type":"application/json"}});
      const aiReply=gRes.data?.candidates?.[0]?.content?.parts?.[0]?.text||"（顧客）はい、続けてください。";

      s.conversationHistory.push({role:"assistant",content:aiReply});
      s.rpTurn++; s.turnCount++;
      return res.json({reply:aiReply});
    }catch(e){
      console.error("Gemini RP error:",e.response?.data||e);
      const aiReply="（顧客）失礼しました。もう一度お願いします。";
      s.conversationHistory.push({role:"assistant",content:aiReply});
      s.turnCount++; return res.json({reply:aiReply});
    }
  }

  /* fallback */
  s.turnCount++; return res.json({reply:"入力を理解できませんでした。"});
});

/* ─────── 画面ルーティング ─────── */
app.get("/",       (_,res)=>res.redirect("/chat"));
app.get("/chat",   (_,res)=>res.sendFile(path.join(__dirname,"public","chat.html")));
app.get("/register",(_,res)=>res.sendFile(path.join(__dirname,"public","register.html")));
app.get("/start",  (_,res)=>res.sendFile(path.join(__dirname,"public","login.html")));

/* ─────── Google OAuth (任意) ─────── */
const oauth2Client=new OAuth2Client(GOOGLE_CLIENT_ID,GOOGLE_CLIENT_SECRET,GOOGLE_CALLBACK);
app.get("/auth/google",(_,res)=>{
  const url=oauth2Client.generateAuthUrl({access_type:"offline",scope:["profile","email"]});
  res.redirect(url);
});
app.get("/auth/google/callback",async(req,res)=>{
  try{const {tokens}=await oauth2Client.getToken(req.query.code);oauth2Client.setCredentials(tokens);res.redirect("/chat");}
  catch(e){console.error(e);res.status(500).send("OAuth error");}
});

/* ─────── Auth REST (register / login) ─────── */
app.post("/api/register",async(req,res)=>{
  const {email,password}=req.body;
  try{
    const user=await admin.auth().createUser({email,password});
    await firestore.collection("users").doc(user.uid).set({
      email,created_at:admin.firestore.FieldValue.serverTimestamp()
    });
    res.json({message:"登録成功",uid:user.uid});
  }catch(e){console.error(e);res.status(500).json({message:"登録失敗",error:e.message});}
});
app.post("/api/login",async(req,res)=>{
  const {email,password}=req.body;
  try{
    const r=await axios.post(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_API_KEY}`,{email,password,returnSecureToken:true});
    const uid=r.data.localId;
    req.session.user={uid,email,idToken:r.data.idToken};
    /* users/{uid} が無ければ生成 */
    const ref=firestore.collection("users").doc(uid);
    if(!(await ref.get()).exists){
      await ref.set({email,created_at:admin.firestore.FieldValue.serverTimestamp()});
    }
    res.json({message:"ログイン成功"});
  }catch(e){console.error(e.response?.data||e);res.status(401).json({message:"ログイン失敗"});}
});

/* ─────── 自分の UID 取得 ─────── */
app.get("/api/me",(req,res)=>{
  if(req.session.user){res.json({uid:req.session.user.uid,email:req.session.user.email});}
  else{res.status(401).json({error:"unauthenticated"});}
});

/* ─────── 全セクション統計 (最新回答のみ採用) ─────── */
app.get("/api/user/:uid/stats/all",async(req,res)=>{
  const uid=req.params.uid;
  try{
    const sections=["商品知識の習得","営業マンの基礎マナー","売れる営業マンになるための講座"];
    const result={};
    for(const sec of sections){
      const qSnap=await firestore.collection("questions").where("section","==",sec).get();
      const total=qSnap.size;

      const aSnap=await firestore.collection("users").doc(uid)
        .collection("user_answers").where("section","==",sec)
        .orderBy("answer_timestamp","desc").get();

      const seen=new Set(),latest=[];
      aSnap.forEach(d=>{const v=d.data();if(!seen.has(v.question_id)){latest.push(v);seen.add(v.question_id);}});

      const correct=latest.filter(v=>v.correct).length;
      const accuracy=total?Math.round(correct/total*100):0;
      result[sec]={total,correct,accuracy,history:latest};
    }
    res.json(result);
  }catch(e){console.error(e);res.status(500).json({error:"stats fetch failed"});}
});

/* ─────── ロールプレイング統計（セクション→難易度別）────── */
app.get("/api/user/:uid/roleplay/stats", async (req, res) => {
  const uid = req.params.uid;

  const sections = [
    "対面ロールプレイング（B2B）",
    "対面ロールプレイング（B2C）",
    // 追加があればここに追記
  ];

  try {
    const result = {};

    for (const sec of sections) {
      const snap = await firestore
        .collection("users").doc(uid)
        .collection("roleplay_sessions")
        .where("section", "==", sec)
        .orderBy("start_timestamp", "desc")
        .get();

      // セクション全体
      let total = 0,
          cleared = 0,
          totalDurationSec = 0;

      // 難易度別ハッシュ
      const byDifficulty = {}; // {easy:{…}, hard:{…}, ...}

      snap.forEach(doc => {
        const s = doc.data();
        const diff = s.difficulty || "unknown";   // 難易度キー

        // 難易度キーの初期化
        byDifficulty[diff] ??= {
          total: 0,
          cleared: 0,
          totalDurationSec: 0
        };

        // --- セクション集計 ---
        total++;
        byDifficulty[diff].total++;

        if (s.cleared) {
          cleared++;
          byDifficulty[diff].cleared++;
        }

        // 所要時間
        if (s.end_timestamp && s.start_timestamp) {
          const durSec =
            (s.end_timestamp.toDate() - s.start_timestamp.toDate()) / 1000;

          totalDurationSec += durSec;
          byDifficulty[diff].totalDurationSec += durSec;
        }
      });

      // セクション全体の派生指標
      const avgDurationSec = total ? Math.round(totalDurationSec / total) : 0;
      const clearedRate    = total ? Math.round((cleared / total) * 100) : 0;

      // 難易度別派生指標を付与
      Object.entries(byDifficulty).forEach(([k, v]) => {
        v.avgDurationSec = v.total ? Math.round(v.totalDurationSec / v.total) : 0;
        v.clearedRate    = v.total ? Math.round((v.cleared / v.total) * 100) : 0;
        delete v.totalDurationSec; // 元の合計秒は不要なら削除
      });

      // セクション結果格納
      result[sec] = {
        total,
        cleared,
        clearedRate,
        avgDurationSec,
        byDifficulty       // ← 難易度サブオブジェクト
      };
    }

    res.json(result);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "roleplay stats fetch failed" });
  }
});


/* ─────── サーバー起動 ─────── */
app.listen(PORT,()=>console.log("Server listening on",PORT));
