const express = require("express");
const axios = require("axios");
const router = express.Router();
const pool = require("../config/db");

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

router.post("/recruiter-register", async (req, res) => {
  const client = await pool.connect();
  try {
    const { name, email, password } = req.body; // password still needed for Auth0

    if (!name || !email || !password) {
      return res.status(400).json({ error: "name, email, and password are required" });
    }

    // 1) Create user in Auth0
    const { data: a0 } = await axios.post(`${AUTH0_DOMAIN}/dbconnections/signup`, {
      client_id: RECRUITER_CLIENT_ID,
      email,
      password,
      connection: AUTH0_CONNECTION,
      user_metadata: { name },
    });

    // 2) Insert into Postgres with role fixed to 'recruiter'
    await client.query("BEGIN");

    const insertSQL = `
      INSERT INTO public.users (name, role, email)
      VALUES ($1, $2, $3)
      RETURNING userid
    `;
    const { rows } = await client.query(insertSQL, [name, "recruiter", email]);

    await client.query("COMMIT");

    return res.json({
      message: "User registered",
      auth0_user: a0,
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
  try {
    const { email, password, name, phone } = req.body;

    const response = await axios.post(`${AUTH0_DOMAIN}/dbconnections/signup`, {
      client_id: CANDIDATE_CLIENT_ID,
      email,
      password,
      connection: AUTH0_CONNECTION,
      user_metadata: { name, phone },
    });

    // const userId = response.data._id || response.data.user_id;
    // await assignUserRole(userId);

    res.json({ message: "User registered", user: response.data });
  } catch (error) {
    res.status(400).json({
      error: "Registration failed",
      details: error.response?.data || error.message,
    });
  }
});

router.post("/recruiter-login", async (req, res) => {
  try {
    const { email, password } = req.body;

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
    return res.json({
      access_token: accessToken,
      id_token: tokenRes.data.id_token,
      user,
    });

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
    const { email, password } = req.body;

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
    return res.json({
      access_token: accessToken,
      id_token: tokenRes.data.id_token,
      user,
    });

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
  const { refresh_token } = req.body;
  try {
    const r = await axios.post(`${AUTH0_DOMAIN}/oauth/token`, {
      grant_type: "refresh_token",
      client_id: RECRUITER_CLIENT_ID,
      client_secret: RECRUITER_CLIENT_SECRET,
      refresh_token,
    });

    res.json({ access_token: r.data.access_token, id_token: r.data.id_token });
  } catch (e) {
    res.status(401).json({
      error: "Failed to refresh token",
      details: e.response?.data || e.message
    });
  }
});

router.post("/candidate-refresh-token", async (req, res) => {
  const { refresh_token } = req.body;
  try {
    const r = await axios.post(`${AUTH0_DOMAIN}/oauth/token`, {
      grant_type: "refresh_token",
      client_id: CANDIDATE_CLIENT_ID,
      client_secret: CANDIDATE_CLIENT_SECRET,
      refresh_token,
    });

    res.json({ access_token: r.data.access_token, id_token: r.data.id_token });
  } catch (e) {
    res.status(401).json({
      error: "Failed to refresh token",
      details: e.response?.data || e.message
    });
  }
});




module.exports = router;
