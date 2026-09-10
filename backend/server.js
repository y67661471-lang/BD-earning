require("dotenv").config();

const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

const app = express();

app.use(cors());
app.use(express.json({ limit: "1mb" }));

// =====================================================
// SUPABASE
// =====================================================

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);

// =====================================================
// TELEGRAM AUTHENTICATION
// =====================================================

function verifyTelegramInitData(initData) {
  if (!initData || !process.env.TELEGRAM_BOT_TOKEN) {
    return null;
  }

  try {
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

    if (!authDate) {
      return null;
    }

    // initData valid for 24 hours
    if (Date.now() / 1000 - authDate > 86400) {
      return null;
    }

    const userJson = params.get("user");

    if (!userJson) {
      return null;
    }

    return JSON.parse(userJson);

  } catch (error) {
    console.error("Telegram verification error:", error);
    return null;
  }
}

// =====================================================
// GET TELEGRAM USER FROM REQUEST
// =====================================================

function getTelegramUserFromRequest(req) {
  const initData =
    req.headers["x-telegram-init-data"] ||
    req.body?.initData;

  return verifyTelegramInitData(initData);
}

// =====================================================
// ADMIN AUTHENTICATION
// =====================================================

function verifyAdmin(initData) {
  const telegramUser = verifyTelegramInitData(initData);

  if (!telegramUser || !telegramUser.id) {
    return null;
  }

  if (!process.env.ADMIN_TELEGRAM_ID) {
    console.error("ADMIN_TELEGRAM_ID is missing");
    return null;
  }

  if (
    String(telegramUser.id) !==
    String(process.env.ADMIN_TELEGRAM_ID)
  ) {
    return null;
  }

  return telegramUser;
}

// =====================================================
// STATIC FILES
// =====================================================

app.use(express.static("public"));

app.get("/", (req, res) => {
  res.sendFile(__dirname + "/public/index.html");
});

app.get("/app", (req, res) => {
  res.sendFile(__dirname + "/public/index.html");
});

// =====================================================
// HEALTH CHECK
// =====================================================

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "BD Earning server is running"
  });
});

// =====================================================
// DAILY TIMELINE - PUBLIC
// =====================================================

app.get("/api/timeline/current", async (req, res) => {
  try {
    const now = new Date().toISOString();

    const { data, error } = await supabase
      .from("timeline_posts")
      .select("*")
      .eq("is_active", true)
      .lte("publish_at", now)
      .or(`expires_at.is.null,expires_at.gt.${now}`)
      .order("publish_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error("Timeline error:", error);

      return res.status(500).json({
        success: false,
        error: "Failed to load timeline"
      });
    }

    return res.json({
      success: true,
      post: data || null
    });

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      success: false,
      error: "Server error"
    });
  }
});

// =====================================================
// USERS - PUBLIC BASIC DATA
// =====================================================

app.get("/api/users", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("users")
      .select(`
        id,
        telegram_id,
        username,
        balance,
        total_earned,
        total_withdraw,
        referral_code,
        referred_by,
        is_blocked,
        security_score,
        created_at
      `)
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) {
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }

    return res.json({
      success: true,
      users: data || []
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      error: "Server error"
    });
  }
});

// =====================================================
// TASKS
// =====================================================

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

    return res.json({
      success: true,
      tasks: data || []
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      error: "Server error"
    });
  }
});

// =====================================================
// TELEGRAM LOGIN
// =====================================================

app.post("/api/auth", async (req, res) => {
  try {
    const { initData } = req.body;

    const telegramUser =
      verifyTelegramInitData(initData);

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

    if (!user) {
      const referralCode =
        "BD" + telegramId.slice(-8);

      const result = await supabase
        .from("users")
        .insert({
          telegram_id: telegramId,
          username,
          balance: 0,
          total_earned: 0,
          total_withdraw: 0,
          referral_code: referralCode,
          security_score: 100,
          is_blocked: false
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

    } else {

      // Update username if changed
      await supabase
        .from("users")
        .update({
          username
        })
        .eq("telegram_id", telegramId);
    }

    return res.json({
      success: true,
      user
    });

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      success: false,
      error: "Authentication server error"
    });
  }
});

// =====================================================
// SUB-ADMIN CREATE / GET WALLET
// =====================================================

app.post("/api/sub-admin/create", async (req, res) => {
  try {
    const {
      telegram_id,
      username
    } = req.body;

    if (!telegram_id) {
      return res.status(400).json({
        success: false,
        error: "Telegram ID is required"
      });
    }

    let { data: subAdmin, error } =
      await supabase
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

    const {
      data: wallet,
      error: walletError
    } = await supabase
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

    return res.json({
      success: true,
      sub_admin: subAdmin,
      wallet
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      error: "Sub-admin server error"
    });
  }
});

// =====================================================
// SUB-ADMIN WALLET
// =====================================================

app.get("/api/sub-admin/wallet/:telegramId", async (req, res) => {
  try {

    const telegramId =
      String(req.params.telegramId);

    const {
      data: subAdmin,
      error: adminError
    } = await supabase
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

    const {
      data: wallet,
      error: walletError
    } = await supabase
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

    return res.json({
      success: true,
      wallet
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      error: "Wallet server error"
    });
  }
});

// =====================================================
// SUB-ADMIN CREATE CAMPAIGN
// =====================================================

app.post("/api/sub-admin/campaigns", async (req, res) => {
  try {

    const {
      telegram_id,
      title,
      description,
      ad_url,
      image_url,
      payout,
      daily_budget,
      total_budget,
      min_ads,
      max_ads,
      repeat_hours
    } = req.body;

    if (!telegram_id || !title || !ad_url || !payout) {
      return res.status(400).json({
        success: false,
        error: "Required campaign information is missing"
      });
    }

    const {
      data: subAdmin,
      error: adminError
    } = await supabase
      .from("sub_admins")
      .select("*")
      .eq("telegram_id", String(telegram_id))
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

    if (Number(payout) <= 0) {
      return res.status(400).json({
        success: false,
        error: "Payout must be greater than 0"
      });
    }

    if (Number(min_ads) < 10) {
      return res.status(400).json({
        success: false,
        error: "Minimum ads must be 10"
      });
    }

    if (Number(max_ads) < Number(min_ads)) {
      return res.status(400).json({
        success: false,
        error: "Maximum ads cannot be lower than minimum ads"
      });
    }

    if (Number(repeat_hours) < 1) {
      return res.status(400).json({
        success: false,
        error: "Repeat hours must be at least 1"
      });
    }

    const {
      data: campaign,
      error
    } = await supabase
      .from("ad_campaigns")
      .insert({
        sub_admin_id: subAdmin.id,
        title,
        description: description || null,
        ad_url,
        image_url: image_url || null,
        payout: Number(payout),
        daily_budget: Number(daily_budget) || 0,
        total_budget: Number(total_budget) || 0,
        spent: 0,
        min_ads: Number(min_ads) || 10,
        max_ads: Number(max_ads) || 10,
        repeat_hours: Number(repeat_hours) || 24,
        status: "pending"
      })
      .select()
      .single();

    if (error) {
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }

    return res.json({
      success: true,
      message: "Campaign created successfully",
      campaign
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      error: "Campaign server error"
    });
  }
});

// =====================================================
// SUB-ADMIN CAMPAIGNS
// =====================================================

app.get("/api/sub-admin/campaigns/:telegramId", async (req, res) => {
  try {

    const telegramId =
      String(req.params.telegramId);

    const {
      data: subAdmin,
      error: adminError
    } = await supabase
      .from("sub_admins")
      .select("id")
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

    const {
      data: campaigns,
      error
    } = await supabase
      .from("ad_campaigns")
      .select("*")
      .eq("sub_admin_id", subAdmin.id)
      .order("id", { ascending: false });

    if (error) {
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }

    return res.json({
      success: true,
      campaigns: campaigns || []
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      error: "Campaign server error"
    });
  }
});

// =====================================================
// ADMIN CAMPAIGN STATUS
// =====================================================

app.post("/api/admin/campaign/status", async (req, res) => {
  try {

    const {
      initData,
      campaign_id,
      status
    } = req.body;

    if (!verifyAdmin(initData)) {
      return res.status(403).json({
        success: false,
        error: "Unauthorized admin"
      });
    }

    const allowedStatuses = [
      "pending",
      "active",
      "paused",
      "completed",
      "disabled"
    ];

    if (
      !campaign_id ||
      !allowedStatuses.includes(status)
    ) {
      return res.status(400).json({
        success: false,
        error: "Invalid campaign request"
      });
    }

    const {
      data,
      error
    } = await supabase.rpc(
      "set_campaign_status",
      {
        p_campaign_id: Number(campaign_id),
        p_status: status
      }
    );

    if (error) {
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }

    return res.json(data);

  } catch (error) {
    return res.status(500).json({
      success: false,
      error: "Admin server error"
    });
  }
});

// =====================================================
// ADMIN GET CAMPAIGNS
// =====================================================

app.get("/api/admin/campaigns", async (req, res) => {
  try {

    const initData =
      req.headers["x-telegram-init-data"];

    if (!verifyAdmin(initData)) {
      return res.status(403).json({
        success: false,
        error: "Unauthorized admin"
      });
    }

    const {
      data,
      error
    } = await supabase
      .from("ad_campaigns")
      .select(`
        *,
        sub_admins (
          telegram_id,
          username,
          status
        )
      `)
      .order("id", { ascending: false });

    if (error) {
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }

    return res.json({
      success: true,
      campaigns: data || []
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      error: "Admin campaign server error"
    });
  }
});

// =====================================================
// USER ADVERTISEMENTS
// =====================================================

app.get("/api/advertisements", async (req, res) => {
  try {

    const {
      data,
      error
    } = await supabase
      .from("ad_campaigns")
      .select("*")
      .eq("status", "active")
      .order("id", { ascending: false });

    if (error) {
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }

    return res.json({
      success: true,
      advertisements: data || []
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      error: "Advertisement server error"
    });
  }
});

// =====================================================
// TIMELINE URL VALIDATION
// =====================================================

function isValidHttpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:";
  } catch {
    return false;
  }
}

// =====================================================
// ADMIN CREATE TIMELINE
// =====================================================

app.post("/api/admin/timeline/create", async (req, res) => {
  try {

    const {
      initData,
      title,
      image_url,
      description,
      publish_at,
      expires_at
    } = req.body;

    const admin =
      verifyAdmin(initData);

    if (!admin) {
      return res.status(403).json({
        success: false,
        error: "Unauthorized admin"
      });
    }

    if (
      !image_url ||
      !isValidHttpsUrl(image_url)
    ) {
      return res.status(400).json({
        success: false,
        error: "Valid HTTPS image URL is required"
      });
    }

    const {
      data,
      error
    } = await supabase
      .from("timeline_posts")
      .insert({
        title: title || "BD Earning",
        image_url,
        description:
          description ||
          "Work • Earn • Withdraw",
        publish_at:
          publish_at ||
          new Date().toISOString(),
        expires_at:
          expires_at || null,
        is_active: true
      })
      .select()
      .single();

    if (error) {
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }

    await supabase
      .from("timeline_admin_logs")
      .insert({
        action: "create",
        timeline_id: data.id,
        admin_id: String(admin.id)
      });

    return res.json({
      success: true,
      message: "Daily photo created successfully",
      post: data
    });

  } catch (error) {

    console.error(error);

    return res.status(500).json({
      success: false,
      error: "Admin photo server error"
    });
  }
});

// =====================================================
// ADMIN GET TIMELINE
// =====================================================

app.get("/api/admin/timeline", async (req, res) => {
  try {

    const initData =
      req.headers["x-telegram-init-data"];

    const admin =
      verifyAdmin(initData);

    if (!admin) {
      return res.status(403).json({
        success: false,
        error: "Unauthorized admin"
      });
    }

    const {
      data,
      error
    } = await supabase
      .from("timeline_posts")
      .select("*")
      .order("id", { ascending: false });

    if (error) {
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }

    return res.json({
      success: true,
      posts: data || []
    });

  } catch (error) {

    return res.status(500).json({
      success: false,
      error: "Timeline server error"
    });
  }
});

// =====================================================
// ADMIN ENABLE / DISABLE TIMELINE
// =====================================================

app.post("/api/admin/timeline/toggle", async (req, res) => {
  try {

    const {
      initData,
      timeline_id,
      id,
      is_active
    } = req.body;

    const admin =
      verifyAdmin(initData);

    if (!admin) {
      return res.status(403).json({
        success: false,
        error: "Unauthorized admin"
      });
    }

    // Support both timeline_id and id
    const finalId =
      timeline_id || id;

    if (!finalId) {
      return res.status(400).json({
        success: false,
        error: "Timeline ID is required"
      });
    }

    const {
      data,
      error
    } = await supabase
      .from("timeline_posts")
      .update({
        is_active: Boolean(is_active)
      })
      .eq("id", Number(finalId))
      .select()
      .single();

    if (error) {
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }

    await supabase
      .from("timeline_admin_logs")
      .insert({
        action:
          Boolean(is_active)
            ? "activate"
            : "disable",
        timeline_id: data.id,
        admin_id: String(admin.id)
      });

    return res.json({
      success: true,
      post: data
    });

  } catch (error) {

    console.error(error);

    return res.status(500).json({
      success: false,
      error: "Timeline update error"
    });
  }
});

// =====================================================
// ADMIN USER MANAGEMENT
// =====================================================

app.get("/api/admin/users", async (req, res) => {
  try {

    const initData =
      req.headers["x-telegram-init-data"];

    if (!verifyAdmin(initData)) {
      return res.status(403).json({
        success: false,
        error: "Unauthorized"
      });
    }

    const {
      data,
      error
    } = await supabase
      .from("users")
      .select(`
        id,
        telegram_id,
        username,
        balance,
        total_earned,
        total_withdraw,
        referral_code,
        referred_by,
        is_blocked,
        security_score,
        created_at
      `)
      .order("created_at", { ascending: false });

    if (error) {
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }

    return res.json({
      success: true,
      users: data || []
    });

  } catch (error) {

    return res.status(500).json({
      success: false,
      error: "Server error"
    });
  }
});

// =====================================================
// ADMIN BLOCK / UNBLOCK USER
// =====================================================

app.post("/api/admin/users/block", async (req, res) => {
  try {

    const initData =
      req.headers["x-telegram-init-data"];

    if (!verifyAdmin(initData)) {
      return res.status(403).json({
        success: false,
        error: "Unauthorized"
      });
    }

    const {
      telegram_id,
      is_blocked
    } = req.body;

    if (!telegram_id) {
      return res.status(400).json({
        success: false,
        error: "telegram_id is required"
      });
    }

    const {
      data,
      error
    } = await supabase
      .from("users")
      .update({
        is_blocked: Boolean(is_blocked)
      })
      .eq("telegram_id", String(telegram_id))
      .select()
      .single();

    if (error) {
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }

    return res.json({
      success: true,
      message:
        Boolean(is_blocked)
          ? "User blocked successfully"
          : "User unblocked successfully",
      user: data
    });

  } catch (error) {

    return res.status(500).json({
      success: false,
      error: "Server error"
    });
  }
});

// =====================================================
// ADMIN WITHDRAWALS
// =====================================================

app.get("/api/admin/withdrawals", async (req, res) => {
  try {

    const initData =
      req.headers["x-telegram-init-data"];

    if (!verifyAdmin(initData)) {
      return res.status(403).json({
        success: false,
        error: "Unauthorized"
      });
    }

    const {
      data,
      error
    } = await supabase
      .from("withdrawals")
      .select(`
        id,
        telegram_id,
        amount,
        method,
        account_number,
        status,
        admin_note,
        created_at,
        processed_at
      `)
      .order("created_at", { ascending: false });

    if (error) {
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }

    return res.json({
      success: true,
      withdrawals: data || []
    });

  } catch (error) {

    return res.status(500).json({
      success: false,
      error: "Server error"
    });
  }
});

// =====================================================
// ADMIN APPROVE / REJECT WITHDRAWAL
// =====================================================

app.post("/api/admin/withdrawals/process", async (req, res) => {
  try {

    const initData =
      req.headers["x-telegram-init-data"];

    if (!verifyAdmin(initData)) {
      return res.status(403).json({
        success: false,
        error: "Unauthorized"
      });
    }

    const {
      withdrawal_id,
      action,
      admin_note
    } = req.body;

    if (!withdrawal_id) {
      return res.status(400).json({
        success: false,
        error: "withdrawal_id is required"
      });
    }

    if (
      !["approved", "rejected"].includes(action)
    ) {
      return res.status(400).json({
        success: false,
        error: "Invalid action"
      });
    }

    const {
      data,
      error
    } = await supabase.rpc(
      "process_withdrawal",
      {
        p_withdrawal_id:
          Number(withdrawal_id),
        p_action: action,
        p_admin_note:
          admin_note || null
      }
    );

    if (error) {
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }

    return res.json(data);

  } catch (error) {

    return res.status(500).json({
      success: false,
      error: "Server error"
    });
  }
});

// =====================================================
// USER WITHDRAWAL REQUEST
// =====================================================

app.post("/api/withdraw", async (req, res) => {

  try {

    const initData =
      req.headers["x-telegram-init-data"];

    // -------------------------------------------------
    // VERIFY TELEGRAM
    // -------------------------------------------------

    const telegramUser =
      verifyTelegramInitData(initData);

    if (!telegramUser || !telegramUser.id) {
      return res.status(403).json({
        success: false,
        error: "Invalid Telegram authentication"
      });
    }

    const telegramId =
      String(telegramUser.id);

    // -------------------------------------------------
    // INPUT
    // -------------------------------------------------

    const {
      amount,
      method,
      account_number
    } = req.body;

    if (
      amount === undefined ||
      !method ||
      !account_number
    ) {
      return res.status(400).json({
        success: false,
        error: "All fields are required"
      });
    }

    const withdrawAmount =
      Number(amount);

    // -------------------------------------------------
    // AMOUNT VALIDATION
    // -------------------------------------------------

    if (
      !Number.isFinite(withdrawAmount) ||
      withdrawAmount <= 0
    ) {
      return res.status(400).json({
        success: false,
        error: "Invalid amount"
      });
    }

    if (withdrawAmount < 5) {
      return res.status(400).json({
        success: false,
        error: "Minimum withdrawal is $5"
      });
    }

    // -------------------------------------------------
    // PAYMENT METHOD
    // -------------------------------------------------

    const allowedMethods = [
      "bKash",
      "Nagad",
      "Binance"
    ];

    if (!allowedMethods.includes(method)) {
      return res.status(400).json({
        success: false,
        error: "Invalid payment method"
      });
    }

    // -------------------------------------------------
    // ACCOUNT VALIDATION
    // -------------------------------------------------

    const cleanAccount =
      String(account_number).trim();

    if (
      cleanAccount.length < 5 ||
      cleanAccount.length > 50
    ) {
      return res.status(400).json({
        success: false,
        error: "Invalid account number"
      });
    }

    // -------------------------------------------------
    // RATE LIMIT
    // -------------------------------------------------

    const oneHourAgo =
      new Date(
        Date.now() -
        60 * 60 * 1000
      ).toISOString();

    const {
      data: recentWithdrawals,
      error: rateError
    } = await supabase
      .from("withdrawals")
      .select("id")
      .eq("telegram_id", telegramId)
      .gte("created_at", oneHourAgo);

    if (rateError) {
      return res.status(500).json({
        success: false,
        error: "Security check failed"
      });
    }

    // Maximum 3 requests per hour
    if (
      recentWithdrawals &&
      recentWithdrawals.length >= 3
    ) {
      return res.status(429).json({
        success: false,
        error:
          "Too many withdrawal requests. Please try again later."
      });
    }

    // -------------------------------------------------
    // GET USER
    // -------------------------------------------------

    const {
      data: user,
      error: userError
    } = await supabase
      .from("users")
      .select(`
        telegram_id,
        balance,
        is_blocked,
        security_score
      `)
      .eq("telegram_id", telegramId)
      .single();

    if (userError || !user) {
      return res.status(404).json({
        success: false,
        error: "User not found"
      });
    }

    // -------------------------------------------------
    // BLOCKED USER CHECK
    // -------------------------------------------------

    if (user.is_blocked) {
      return res.status(403).json({
        success: false,
        error: "Account is blocked"
      });
    }

    // -------------------------------------------------
    // SECURITY SCORE CHECK
    // -------------------------------------------------

    const securityScore =
      Number(user.security_score ?? 100);

    if (securityScore < 20) {
      return res.status(403).json({
        success: false,
        error:
          "Withdrawal temporarily restricted for security review"
      });
    }

    // -------------------------------------------------
    // BALANCE CHECK
    // -------------------------------------------------

    if (
      Number(user.balance) <
      withdrawAmount
    ) {
      return res.status(400).json({
        success: false,
        error: "Insufficient balance"
      });
    }

    // -------------------------------------------------
    // PENDING WITHDRAWAL CHECK
    // -------------------------------------------------

    const {
      data: pending,
      error: pendingError
    } = await supabase
      .from("withdrawals")
      .select("id")
      .eq("telegram_id", telegramId)
      .eq("status", "pending")
      .limit(1);

    if (pendingError) {
      return res.status(500).json({
        success: false,
        error: "Pending withdrawal check failed"
      });
    }

    if (
      pending &&
      pending.length > 0
    ) {
      return res.status(400).json({
        success: false,
        error:
          "You already have a pending withdrawal"
      });
    }

    // -------------------------------------------------
    // CREATE WITHDRAWAL
    // -------------------------------------------------

    const {
      data,
      error
    } = await supabase
      .from("withdrawals")
      .insert({
        telegram_id: telegramId,
        amount: withdrawAmount,
        method,
        account_number: cleanAccount,
        status: "pending"
      })
      .select()
      .single();

    if (error) {
      console.error(
        "Withdrawal insert error:",
        error
      );

      return res.status(500).json({
        success: false,
        error: error.message
      });
    }

    return res.json({
      success: true,
      message:
        "Withdrawal request submitted successfully",
      withdrawal: data
    });

  } catch (error) {

    console.error(
      "Withdrawal error:",
      error
    );

    return res.status(500).json({
      success: false,
      error: "Server error"
    });
  }
});

// =====================================================
// USER WITHDRAWAL HISTORY
// =====================================================

app.get("/api/withdrawals/:telegramId", async (req, res) => {

  try {

    const initData =
      req.headers["x-telegram-init-data"];

    const telegramUser =
      verifyTelegramInitData(initData);

    if (!telegramUser || !telegramUser.id) {
      return res.status(403).json({
        success: false,
        error: "Invalid Telegram authentication"
      });
    }

    const telegramId =
      String(req.params.telegramId);

    // User can only view their own withdrawals
    if (
      String(telegramUser.id) !==
      telegramId
    ) {
      return res.status(403).json({
        success: false,
        error: "Unauthorized"
      });
    }

    const {
      data,
      error
    } = await supabase
      .from("withdrawals")
      .select(`
        id,
        amount,
        method,
        account_number,
        status,
        admin_note,
        created_at,
        processed_at
      `)
      .eq("telegram_id", telegramId)
      .order("created_at", {
        ascending: false
      });

    if (error) {
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }

    return res.json({
      success: true,
      withdrawals: data || []
    });

  } catch (error) {

    return res.status(500).json({
      success: false,
      error: "Server error"
    });
  }
});

// =====================================================
// 404
// =====================================================

app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: "API route not found"
  });
});

// =====================================================
// ERROR HANDLER
// =====================================================

app.use((err, req, res, next) => {

  console.error("Unhandled error:", err);

  res.status(500).json({
    success: false,
    error: "Internal server error"
  });
});

// =====================================================
// EXPORT
// =====================================================

module.exports = app;
