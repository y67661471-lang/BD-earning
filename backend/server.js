require("dotenv").config();

const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static("public"));

app.get("/app", (req, res) => {
  res.sendFile(__dirname + "/public/index.html");
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);

// Telegram initData verification
function verifyTelegramInitData(initData) {
  if (!initData || !process.env.TELEGRAM_BOT_TOKEN) {
    return null;
  }

  const params = new URLSearchParams(initData);
  const receivedHash = params.get("hash");

  if (!receivedHash) {
    return null;
  }

  params.delete("hash");

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secretKey = crypto
    .createHmac("sha256", "WebAppData")
    .update(process.env.TELEGRAM_BOT_TOKEN)
    .digest();

  const calculatedHash = crypto
    .createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  if (calculatedHash.length !== receivedHash.length) {
    return null;
  }

  if (
    !crypto.timingSafeEqual(
      Buffer.from(calculatedHash),
      Buffer.from(receivedHash)
    )
  ) {
    return null;
  }

  const authDate = Number(params.get("auth_date"));

  if (!authDate || Date.now() / 1000 - authDate > 86400) {
    return null;
  }

  try {
    return JSON.parse(params.get("user"));
  } catch {
    return null;
  }
}

// API status
app.get("/", (req, res) => {
  res.json({
    status: "online",
    message: "BD Earning API is running"
  });
});

// Telegram login
app.post("/api/auth", async (req, res) => {
  try {
    const { initData } = req.body;

    const telegramUser = verifyTelegramInitData(initData);

    if (!telegramUser || !telegramUser.id) {
      return res.status(401).json({
        success: false,
        error: "Invalid Telegram authentication"
      });
    }

    const telegramId = String(telegramUser.id);
    const username = telegramUser.username || null;

    let { data: user, error } = await supabase
      .from("users")
      .select("*")
      .eq("telegram_id", telegramId)
      .maybeSingle();

    if (error) {
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }

    // Create new user
    if (!user) {
      const referralCode = "BD" + telegramId.slice(-8);

      const result = await supabase
        .from("users")
        .insert({
          telegram_id: telegramId,
          username: username,
          balance: 0,
          total_earned: 0,
          total_withdraw: 0,
          referral_code: referralCode
        })
        .select()
        .single();

      if (result.error) {
        return res.status(500).json({
          success: false,
          error: result.error.message
        });
      }

      user = result.data;
    }

    res.json({
      success: true,
      user: user
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Authentication server error"
    });
  }
});

module.exports = app;
