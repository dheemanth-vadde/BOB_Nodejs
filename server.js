require("dotenv").config();
const express = require("express");
const cors = require("cors");
const authRoutes = require("./routes/auth");
const protectedRoutes = require("./routes/protected");
const offerLettersRouter = require("./routes/offerLetters"); 
//const calendarRoutes = require("./routes/calendar");
// const paymentsRazorpay = require("./routes/payments.razorpay");
//const gcalRoutes = require("./routes/gcal");



const app = express();
app.use(cors());
app.use(express.json());

app.use("/api", protectedRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/offer-letters", offerLettersRouter);
//app.use("/api/gcal", gcalRoutes);
//app.use("/api/calendar",calendarRoutes);


app.listen(process.env.PORT, () => {
  console.log(`Server running on port ${process.env.PORT}`);
});
