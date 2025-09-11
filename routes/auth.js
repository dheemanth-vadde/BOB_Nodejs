const express = require("express");
const axios = require("axios");
const router = express.Router();
const pool = require("../config/db");
const CryptoJS = require("crypto-js");
const SECRET_KEY = "fdf4-832b-b4fd-ccfb9258a6b3";

const {
  AUTH0_DOMAIN,
  AUTH0_CONNECTION,
  RECRUITER_CLIENT_ID,
  RECRUITER_CLIENT_SECRET,
  CANDIDATE_CLIENT_ID,
  CANDIDATE_CLIENT_SECRET,
  M2M_CLIENT_ID,
  M2M_CLIENT_SECRET,
} = process.env;

// 🔑 AES Decrypt helper
function decryptPassword(encryptedPassword) {
  try {
    const bytes = CryptoJS.AES.decrypt(encryptedPassword, SECRET_KEY);
    return bytes.toString(CryptoJS.enc.Utf8); // plain text
  } catch (err) {
    console.error("Decryption failed:", err);
    return null;
  }
}

router.post("/recruiter-register", async (req, res) => {
  const client = await pool.connect();
  try {
    const { name, email, password: encryptedPassword, role } = req.body;

    if (!name || !email || !encryptedPassword || !role) {
      return res
        .status(400)
        .json({ error: "name, email, password, and role are required" });
    }

    const decryptedPassword = decryptPassword(encryptedPassword);
    if (!decryptedPassword) {
      return res.status(400).json({ error: "Invalid password encryption" });
    }

    let a0 = null;
    const isInterviewer = String(role).toLowerCase() === "interviewer";

    // 1) Create user in Auth0 for NON-interviewer roles only
    if (!isInterviewer) {
      const { data } = await axios.post(
        `${AUTH0_DOMAIN}/dbconnections/signup`,
        {
          client_id: RECRUITER_CLIENT_ID,
          email,
          password: decryptedPassword,
          connection: AUTH0_CONNECTION,
          user_metadata: { name },
        }
      );
      a0 = data; // <- assign the response data to a0
    }

    // 2) Insert into Postgres
    await client.query("BEGIN");
    const insertSQL = `
      INSERT INTO public.users (name, role, email, manager_id, user_password)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING userid
    `;
    const { rows } = await client.query(insertSQL, [
      name,
      role,       // e.g. "Interviewer" or "Recruiter"
      email,
      "2",
      encryptedPassword, // store encrypted version
    ]);
    await client.query("COMMIT");

    return res.json({
      message: isInterviewer
        ? "Interviewer registered (DB only)"
        : "User registered",
      auth0_user: a0,                 // null for Interviewer
      local_user_id: rows[0].userid,
    });
  } catch (err) {
    await client.query("ROLLBACK");

    if (err?.code === "23505") {
      return res.status(409).json({ error: "Email already registered" });
    }

    return res.status(400).json({
      error: "Registration failed",
      details: err.response?.data || err.message,
    });
  } finally {
    client.release();
  }
});


router.post("/candidate-register", async (req, res) => {
  const client = await pool.connect();
  try {
    const { name, email, password: encryptedPassword } = req.body;

    if (!name || !email || !encryptedPassword) {
      return res.status(400).json({ error: "name, email, and password are required" });
    }

    // Decrypt for Auth0
    const decryptedPassword = decryptPassword(encryptedPassword);
    if (!decryptedPassword) {
      return res.status(400).json({ error: "Invalid password encryption" });
    }

    // 1) Create user in Auth0
    const { data: a0 } = await axios.post(`${AUTH0_DOMAIN}/dbconnections/signup`, {
      client_id: CANDIDATE_CLIENT_ID,
      email,
      password: decryptedPassword,
      connection: AUTH0_CONNECTION,
      user_metadata: { name },
    });

    // 2) Insert into candidates table (only the required fields)
    await client.query("BEGIN");

    const insertSQL = `
      INSERT INTO public.candidates ( full_name, email, username, password_hash, created_date)
      VALUES ($1, $2 , $3, $4, NOW())
      RETURNING candidate_id
    `;
    const { rows } = await client.query(insertSQL, [name,  email, name , encryptedPassword ]);

    await client.query("COMMIT");

  
    return res.json({
      message: "Candidate registered",
      auth0_user: a0,
      candidate_id : rows[0].candidate_id
    });
  } catch (err) {
    await client.query("ROLLBACK");

    if (err?.code === "23505") {
      return res.status(409).json({ error: "Candidate ID or Email already exists" });
    }
    return res.status(400).json({
      error: "Registration failed",
      details: err.response?.data || err.message,
    });
  } finally {
    client.release();
  }
});


router.post("/recruiter-login", async (req, res) => {
  try {
    const { email, password: encryptedPassword } = req.body;

    const password = decryptPassword(encryptedPassword);

    // Get token from Auth0
    const tokenRes = await axios.post(`${AUTH0_DOMAIN}/oauth/token`, {
      grant_type: "http://auth0.com/oauth/grant-type/password-realm",
      username: email,
      password,
      audience: `${AUTH0_DOMAIN}/api/v2/`,
      scope: "openid profile email offline_access",
      client_id: RECRUITER_CLIENT_ID,
      client_secret: RECRUITER_CLIENT_SECRET,
      realm: AUTH0_CONNECTION,
    });

    const accessToken = tokenRes.data.access_token;
    const refreshToken = tokenRes.data.refresh_token;
    const idToken = tokenRes.data.id_token;

    // Fetch user info to check if email is verified
    const userInfoRes = await axios.get(`${AUTH0_DOMAIN}/userinfo`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    const user = userInfoRes.data;
    console.log("User Info:", user);

   if (!user.email_verified) {
  return res.status(403).json({
    error: "Email not verified. Please verify your email before login.",
    user_id: user.sub, // send this so frontend can use it
  });
}


    // Check for MFA
    if (tokenRes.data.mfa_required) {
      return res.json({
        mfa_required: true,
        mfa_token: tokenRes.data.mfa_token,
      });
    }

    // Success
    // return res.json({
    //   access_token: accessToken,
    //   id_token: tokenRes.data.id_token,
    //   user,
    // });
    // ✅ Set HTTP-only cookies
    res
      .cookie("access_token", accessToken, {
        httpOnly: true,
        secure: true,
        sameSite: "Strict",
        maxAge: 15 * 60 * 1000, // 15 min
        path: "/",
      })
      .cookie("refresh_token", refreshToken, {
        httpOnly: true,
        secure: true,
        sameSite: "Strict",
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
        path: "/",
      })
      .cookie("id_token", idToken, {
        httpOnly: true,
        secure: true,
        sameSite: "Strict",
        maxAge: 15 * 60 * 1000,
        path: "/",
      })
      .json({ user }); // safe user info only

  } catch (error) {
    const errData = error.response?.data;
    console.error("Login error:", errData || error.message);

    if (errData?.error === "mfa_required") {
      return res.json({
        mfa_required: true,
        mfa_token: errData.mfa_token,
      });
    }

    return res.status(401).json({
      error: "Login failed",
      error_description: errData?.error_description || error.message,
    });
  }
});

router.post("/candidate-login", async (req, res) => {
  try {
    const { email, password: encryptedPassword } = req.body;

    const password = decryptPassword(encryptedPassword);

    // Get token from Auth0
    const tokenRes = await axios.post(`${AUTH0_DOMAIN}/oauth/token`, {
      grant_type: "http://auth0.com/oauth/grant-type/password-realm",
      username: email,
      password,
      audience: `${AUTH0_DOMAIN}/api/v2/`,
      scope: "openid profile email offline_access",
      client_id: CANDIDATE_CLIENT_ID,
      client_secret: CANDIDATE_CLIENT_SECRET,
      realm: AUTH0_CONNECTION,
    });

    const accessToken = tokenRes.data.access_token;
    const refreshToken = tokenRes.data.refresh_token;
    const idToken = tokenRes.data.id_token;

    // Fetch user info to check if email is verified
    const userInfoRes = await axios.get(`${AUTH0_DOMAIN}/userinfo`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    const user = userInfoRes.data;
    console.log("User Info:", user);

   if (!user.email_verified) {
  return res.status(403).json({
    error: "Email not verified. Please verify your email before login.",
    user_id: user.sub, // send this so frontend can use it
  });
}


    // Check for MFA
    if (tokenRes.data.mfa_required) {
      return res.json({
        mfa_required: true,
        mfa_token: tokenRes.data.mfa_token,
      });
    }

    // Success
    // ✅ Set HTTP-only cookies
    res
      .cookie("access_token", accessToken, {
        httpOnly: true,
        secure: true,
        sameSite: "Strict",
        maxAge: 15 * 60 * 1000, // 15 min
        path: "/",
      })
      .cookie("refresh_token", refreshToken, {
        httpOnly: true,
        secure: true,
        sameSite: "Strict",
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
        path: "/",
      })
      .cookie("id_token", idToken, {
        httpOnly: true,
        secure: true,
        sameSite: "Strict",
        maxAge: 15 * 60 * 1000,
        path: "/",
      })
      .json({ user }); // safe user info only

  } catch (error) {
    const errData = error.response?.data;
    console.error("Login error:", errData || error.message);

    if (errData?.error === "mfa_required") {
      return res.json({
        mfa_required: true,
        mfa_token: errData.mfa_token,
      });
    }

    return res.status(401).json({
      error: "Login failed",
      error_description: errData?.error_description || error.message,
    });
  }
});

router.post("/candidate-resend-verification", async (req, res) => {
  const { user_id } = req.body;

  try {
    // Step 1: Get Management API token
    const tokenRes = await axios.post(`${AUTH0_DOMAIN}/oauth/token`, {
      client_id: M2M_CLIENT_ID,
      client_secret: M2M_CLIENT_SECRET,
      audience: `${AUTH0_DOMAIN}/api/v2/`,
      grant_type: "client_credentials",
    });

    const mgmtToken = tokenRes.data.access_token;

    // Step 2: Trigger resend email
    await axios.post(
      `${AUTH0_DOMAIN}/api/v2/jobs/verification-email`,
      { user_id },
      {
        headers: {
          Authorization: `Bearer ${mgmtToken}`,
        },
      }
    );

    res.json({ message: "Verification email sent." });
 } catch (err) {
  console.error("Resend failed:", err.response?.data || err.message);
  res.status(500).json({
    error: "Failed to resend verification email",
    details: err.response?.data || err.message,  // return error details
  });
}

});

router.post("/recruiter-resend-verification", async (req, res) => {
  const { user_id } = req.body;

  try {
    // Step 1: Get Management API token
    const tokenRes = await axios.post(`${AUTH0_DOMAIN}/oauth/token`, {
      client_id: M2M_CLIENT_ID,
      client_secret: M2M_CLIENT_SECRET,
      audience: `${AUTH0_DOMAIN}/api/v2/`,
      grant_type: "client_credentials",
    });

    const mgmtToken = tokenRes.data.access_token;

    // Step 2: Trigger resend email
    await axios.post(
      `${AUTH0_DOMAIN}/api/v2/jobs/verification-email`,
      { user_id },
      {
        headers: {
          Authorization: `Bearer ${mgmtToken}`,
        },
      }
    );

    res.json({ message: "Verification email sent." });
 } catch (err) {
  console.error("Resend failed:", err.response?.data || err.message);
  res.status(500).json({
    error: "Failed to resend verification email",
    details: err.response?.data || err.message,  // return error details
  });
}

});

router.post("/recruiter-forgot-password", async (req, res) => {
  const { email } = req.body;

  try {
    const tokenRes = await axios.post(`${AUTH0_DOMAIN}/oauth/token`, {
      client_id: M2M_CLIENT_ID,
      client_secret: M2M_CLIENT_SECRET,
      audience: `${AUTH0_DOMAIN}/api/v2/`,
      grant_type: "client_credentials",
    });

    const mgmtToken = tokenRes.data.access_token;

    await axios.post(
      `${AUTH0_DOMAIN}/dbconnections/change_password`,
      {
        client_id: RECRUITER_CLIENT_ID,
        email,
        connection: AUTH0_CONNECTION,
      },
      {
        headers: {
          Authorization: `Bearer ${mgmtToken}`,
        },
      }
    );

    res.json({ message: "Password reset email sent." });
  } catch (err) {
    console.error("Reset password error:", err.response?.data || err.message);
    res.status(500).json({ error: "Failed to send reset email" });
  }
});

router.post("/candidate-forgot-password", async (req, res) => {
  const { email } = req.body;

  try {
    const tokenRes = await axios.post(`${AUTH0_DOMAIN}/oauth/token`, {
      client_id: M2M_CLIENT_ID,
      client_secret: M2M_CLIENT_SECRET,
      audience: `${AUTH0_DOMAIN}/api/v2/`,
      grant_type: "client_credentials",
    });

    const mgmtToken = tokenRes.data.access_token;

    await axios.post(
      `${AUTH0_DOMAIN}/dbconnections/change_password`,
      {
        client_id: CANDIDATE_CLIENT_ID,
        email,
        connection: AUTH0_CONNECTION,
      },
      {
        headers: {
          Authorization: `Bearer ${mgmtToken}`,
        },
      }
    );

    res.json({ message: "Password reset email sent." });
  } catch (err) {
    console.error("Reset password error:", err.response?.data || err.message);
    res.status(500).json({ error: "Failed to send reset email" });
  }
});


router.post("/recruiter-refresh-token", async (req, res) => {
  const refreshToken = req.cookies.refresh_token
  if (!refreshToken) return res.status(401).json({ error: "No refresh token" });
  
  try {
    const r = await axios.post(`${AUTH0_DOMAIN}/oauth/token`, {
      grant_type: "refresh_token",
      client_id: RECRUITER_CLIENT_ID,
      client_secret: RECRUITER_CLIENT_SECRET,
      refresh_token: refreshToken,
    });

    const accessToken = tokenRes.data.access_token;
    const idToken = tokenRes.data.id_token;

    // res.json({ access_token: r.data.access_token, id_token: r.data.id_token });
    res
      .cookie("access_token", accessToken, {
        httpOnly: true,
        secure: true,
        sameSite: "Strict",
        maxAge: 15 * 60 * 1000,
        path: "/",
      })
      .cookie("id_token", idToken, {
        httpOnly: true,
        secure: true,
        sameSite: "Strict",
        maxAge: 15 * 60 * 1000,
        path: "/",
      })
      .json({ message: "Token refreshed" });
  } catch (e) {
    res.status(401).json({
      error: "Failed to refresh token",
      details: e.response?.data || e.message
    });
  }
});

router.post("/candidate-refresh-token", async (req, res) => {
  const refreshToken = req.cookies.refresh_token;
  if (!refreshToken) return res.status(401).json({ error: "No refresh token" });

  try {
    const tokenRes = await axios.post(`${AUTH0_DOMAIN}/oauth/token`, {
      grant_type: "refresh_token",
      client_id: CANDIDATE_CLIENT_ID,
      client_secret: CANDIDATE_CLIENT_SECRET,
      refresh_token: refreshToken,
    });

    const accessToken = tokenRes.data.access_token;
    const idToken = tokenRes.data.id_token;

    res
      .cookie("access_token", accessToken, {
        httpOnly: true,
        secure: true,
        sameSite: "Strict",
        maxAge: 15 * 60 * 1000,
        path: "/",
      })
      .cookie("id_token", idToken, {
        httpOnly: true,
        secure: true,
        sameSite: "Strict",
        maxAge: 15 * 60 * 1000,
        path: "/",
      })
      .json({ message: "Token refreshed", access_token: accessToken, id_token: idToken });
  } catch (e) {
    res.status(401).json({
      error: "Failed to refresh token",
      details: e.response?.data || e.message,
    });
  }
});



module.exports = router;
