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
// Get users - testing only
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

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);
// Get active tasks
app.get("/api/tasks", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("tasks")
      .select("*")
      .eq("is_active", true)
      .order("id", { ascending: false });

    if (error) {
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }

    res.json({
      success: true,
      tasks: data
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Server error"
    });
  }
});

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
app.get("/", (req, res) => {
  res.sendFile(__dirname + "/public/index.html");
});

// Telegram login
app.post("/api/auth", async (req, res) => {
  try {
    const { initData } = req.body;
// ===============================
// SUB ADMIN WALLET
// ===============================

// Create / get sub-admin
app.post("/api/sub-admin/create", async (req, res) => {
  try {
    const { telegram_id, username } = req.body;

    if (!telegram_id) {
      return res.status(400).json({
        success: false,
        error: "Telegram ID is required"
      });
    }

    let { data: subAdmin, error } = await supabase
      .from("sub_admins")
      .select("*")
      .eq("telegram_id", String(telegram_id))
      .maybeSingle();

    if (error) {
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }

    if (!subAdmin) {
      const result = await supabase
        .from("sub_admins")
        .insert({
          telegram_id: String(telegram_id),
          username: username || null,
          status: "active"
        })
        .select()
        .single();

      if (result.error) {
        return res.status(500).json({
          success: false,
          error: result.error.message
        });
      }

      subAdmin = result.data;

      // Create wallet
      const wallet = await supabase
        .from("sub_admin_wallets")
        .insert({
          sub_admin_id: subAdmin.id,
          balance: 0,
          total_deposited: 0,
          total_spent: 0,
          total_transferred: 0
        })
        .select()
        .single();

      if (wallet.error) {
        return res.status(500).json({
          success: false,
          error: wallet.error.message
        });
      }
    }

    const { data: wallet, error: walletError } = await supabase
      .from("sub_admin_wallets")
      .select("*")
      .eq("sub_admin_id", subAdmin.id)
      .maybeSingle();

    if (walletError) {
      return res.status(500).json({
        success: false,
        error: walletError.message
      });
    }

    res.json({
      success: true,
      sub_admin: subAdmin,
      wallet: wallet
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Sub-admin server error"
    });
  }
});


// Get sub-admin wallet
app.get("/api/sub-admin/wallet/:telegramId", async (req, res) => {
  try {
    const telegramId = String(req.params.telegramId);

    const { data: subAdmin, error: adminError } = await supabase
      .from("sub_admins")
      .select("*")
      .eq("telegram_id", telegramId)
      .maybeSingle();

    if (adminError) {
      return res.status(500).json({
        success: false,
        error: adminError.message
      });
    }

    if (!subAdmin) {
      return res.status(404).json({
        success: false,
        error: "Sub-admin not found"
      });
    }

    const { data: wallet, error: walletError } = await supabase
      .from("sub_admin_wallets")
      .select("*")
      .eq("sub_admin_id", subAdmin.id)
      .maybeSingle();

    if (walletError) {
      return res.status(500).json({
        success: false,
        error: walletError.message
      });
    }

    res.json({
      success: true,
      wallet: wallet
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Wallet server error"
    });
  }
});
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
