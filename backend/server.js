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

// =====================================================
// TELEGRAM AUTHENTICATION
// =====================================================

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

// =====================================================
// ADMIN AUTHENTICATION
// =====================================================

function verifyAdmin(initData) {
  const telegramUser = verifyTelegramInitData(initData);

  if (!telegramUser || !telegramUser.id) {
    return null;
  }

  if (
    !process.env.ADMIN_TELEGRAM_ID ||
    String(telegramUser.id) !== String(process.env.ADMIN_TELEGRAM_ID)
  ) {
    return null;
  }

  return telegramUser;
}

// =====================================================
// BASIC ROUTES
// =====================================================

app.use(express.static("public"));

app.get("/", (req, res) => {
  res.sendFile(__dirname + "/public/index.html");
});

app.get("/app", (req, res) => {
  res.sendFile(__dirname + "/public/index.html");
});

// =====================================================
// DAILY AUTO TIMELINE PHOTO
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

    res.json({
      success: true,
      post: data || null
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      error: "Server error"
    });
  }
});

// =====================================================
// TEST USERS
// =====================================================

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

// =====================================================
// TELEGRAM LOGIN
// =====================================================

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

    if (!user) {
      const referralCode = "BD" + telegramId.slice(-8);

      const result = await supabase
        .from("users")
        .insert({
          telegram_id: telegramId,
          username,
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
      user
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
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
      wallet
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      error: "Sub-admin server error"
    });
  }
});

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
      wallet
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Wallet server error"
    });
  }
});

// =====================================================
// SUB-ADMIN AD CAMPAIGNS
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

    const { data: subAdmin, error: adminError } = await supabase
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

    const { data: campaign, error } = await supabase
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

    res.json({
      success: true,
      message: "Campaign created successfully",
      campaign
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Campaign server error"
    });
  }
});

app.get("/api/sub-admin/campaigns/:telegramId", async (req, res) => {
  try {
    const telegramId = String(req.params.telegramId);

    const { data: subAdmin, error: adminError } = await supabase
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

    const { data: campaigns, error } = await supabase
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

    res.json({
      success: true,
      campaigns
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Campaign server error"
    });
  }
});

// =====================================================
// ADMIN CAMPAIGN CONTROL
// =====================================================

app.post("/api/admin/campaign/status", async (req, res) => {
  try {
    const { initData, campaign_id, status } = req.body;

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

    if (!campaign_id || !allowedStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        error: "Invalid campaign request"
      });
    }

    const { data, error } = await supabase.rpc(
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

    res.json(data);

  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Admin server error"
    });
  }
});

app.get("/api/admin/campaigns", async (req, res) => {
  try {
    const initData = req.headers["x-telegram-init-data"];

    if (!verifyAdmin(initData)) {
      return res.status(403).json({
        success: false,
        error: "Unauthorized admin"
      });
    }

    const { data, error } = await supabase
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

    res.json({
      success: true,
      campaigns: data
    });

  } catch (error) {
    res.status(500).json({
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
    const { data, error } = await supabase
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

    res.json({
      success: true,
      advertisements: data
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Advertisement server error"
    });
  }
});

// =====================================================
// ADMIN DAILY PHOTO MANAGEMENT
// =====================================================

function isValidHttpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:";
  } catch {
    return false;
  }
}

// CREATE PHOTO
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

    const admin = verifyAdmin(initData);

    if (!admin) {
      return res.status(403).json({
        success: false,
        error: "Unauthorized admin"
      });
    }

    if (!image_url || !isValidHttpsUrl(image_url)) {
      return res.status(400).json({
        success: false,
        error: "Valid HTTPS image URL is required"
      });
    }

    const { data, error } = await supabase
      .from("timeline_posts")
      .insert({
        title: title || "BD Earning",
        image_url,
        description: description || "Work • Earn • Withdraw",
        publish_at: publish_at || new Date().toISOString(),
        expires_at: expires_at || null,
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

    res.json({
      success: true,
      message: "Daily photo created successfully",
      post: data
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      error: "Admin photo server error"
    });
  }
});

// GET ALL PHOTOS
app.get("/api/admin/timeline", async (req, res) => {
  try {
    const initData = req.headers["x-telegram-init-data"];

    const admin = verifyAdmin(initData);

    if (!admin) {
      return res.status(403).json({
        success: false,
        error: "Unauthorized admin"
      });
    }

    const { data, error } = await supabase
      .from("timeline_posts")
      .select("*")
      .order("id", { ascending: false });

    if (error) {
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }

    res.json({
      success: true,
      posts: data
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Timeline server error"
    });
  }
});

// ENABLE / DISABLE PHOTO
app.post("/api/admin/timeline/toggle", async (req, res) => {
  try {
    const {
      initData,
      timeline_id,
      is_active
    } = req.body;

    const admin = verifyAdmin(initData);

    if (!admin) {
      return res.status(403).json({
        success: false,
        error: "Unauthorized admin"
      });
    }

    if (!timeline_id) {
      return res.status(400).json({
        success: false,
        error: "Timeline ID is required"
      });
    }

    const { data, error } = await supabase
      .from("timeline_posts")
      .update({
        is_active: Boolean(is_active)
      })
      .eq("id", Number(timeline_id))
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
        action: Boolean(is_active)
          ? "activate"
          : "disable",
        timeline_id: data.id,
        admin_id: String(admin.id)
      });

    res.json({
      success: true,
      post: data
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      error: "Timeline update error"
    });
  }
});

// =====================================================
// START
// =====================================================

module.exports = app;
