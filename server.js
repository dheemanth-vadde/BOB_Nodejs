require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");


const authRoutes = require("./routes/auth");
const protectedRoutes = require("./routes/protected");
const offerLettersRouter = require("./routes/offerLetters"); 
const calendarRoutes = require("./routes/calendar");
const gcalRoutes = require("./routes/gcal");
const paymentsRazorpay = require("./routes/payments.razorpay");
const { rawBody, jsonBody } = require("./utils/bodyParsers");
const getDetailsRoutes = require("./routes/getdetails");
const resumeRoutes = require("./routes/resume");
const offerTemplates = require("./routes/offerTemplates");

const {
  router: razorpayRouter,
  webhookHandler
} = require("./routes/payments.razorpay");


const app = express();

// app.use(cors());
const allowedOrigins = [
  'http://localhost:3000',
  'https://bobrec.sentrifugo.com',
  'https://bobcan.sentrifugo.com'
];
 
app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (Postman, curl)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    } else {
      return callback(new Error('CORS not allowed for this origin'), false);
    }
  },
  methods: ['GET','POST','PUT','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization','Content-Length','X-Requested-With','Accept'],
  credentials: true
}));


app.post(
  "/api/payments/razorpay/webhook",
  express.raw({ type: "application/json" }),
  webhookHandler
);


app.use(
  "/Recruiter/Resumes",
  express.static(path.join(__dirname, "path/to/Resumes"), {
    setHeaders: (res, filepath) => {
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
    },
  })
);

app.use(express.json()); 
app.use("/api", protectedRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/offer-letters", offerLettersRouter);
app.use("/api/gcal", gcalRoutes);
app.use("/api/calendar",calendarRoutes);
app.use("/api/payments/razorpay", razorpayRouter);
app.use("/api/getdetails",getDetailsRoutes);
app.use("/api/resume",resumeRoutes);
app.use("/api/offer-templates", offerTemplates);



app.listen(process.env.PORT, () => {
  console.log(`Server running on port ${process.env.PORT}`);
});
