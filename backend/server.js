require("dotenv").config();

const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

const app = express();

app.use(cors());
app.use(express.json());

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);

// Health check
app.get("/", (req, res) => {
  res.json({
    status: "online",
    message: "BD Earning API is running"
  });
});

// Get users
app.get("/api/users", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("users")
      .select("*")
      .limit(10);

    if (error) {
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }

    res.json({
      success: true,
      users: data
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Server error"
    });
  }
});

// Create / update Telegram user
app.post("/api/users", async (req, res) => {
  try {
    const {
      telegram_id,
      username,
      referral_code
    } = req.body;

    if (!telegram_id) {
      return res.status(400).json({
        success: false,
        error: "Telegram ID is required"
      });
    }

    const { data: existingUser } = await supabase
      .from("users")
      .select("*")
      .eq("telegram_id", String(telegram_id))
      .maybeSingle();

    if (existingUser) {
      return res.json({
        success: true,
        user: existingUser,
        new_user: false
      });
    }

    const userReferralCode =
      "BD" + String(telegram_id).slice(-8);

    const { data, error } = await supabase
      .from("users")
      .insert({
        telegram_id: String(telegram_id),
        username: username || null,
        balance: 0,
        total_earned: 0,
        total_withdraw: 0,
        referral_code: userReferralCode,
        referred_by: referral_code || null
      })
      .select()
      .single();

    if (error) {
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }

    res.json({
      success: true,
      user: data,
      new_user: true
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Server error"
    });
  }
});

module.exports = app;
