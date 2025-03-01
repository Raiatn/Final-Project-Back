import dotenv from "dotenv";
import express from "express";
import { neon } from "@neondatabase/serverless";
import bcrypt from "bcryptjs";
import cors from "cors";
import jwt from "jsonwebtoken";
import path from "path";
import { fileURLToPath } from "url";
import verifyToken from "./verifyToken.js";
import sendEmail from "./sendEmail.js";
import { scheduleJob } from "node-schedule";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'dist')));

const sql = neon(process.env.DATABASE_URL);
endOfDay();

app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (typeof email !== "string" || typeof password !== "string") {
      return res.status(400).json({ error: "Inputs must be valid strings." });
    }

    const trimmedEmail = email.trim().toLowerCase();

    const user = await sql`SELECT * FROM public.users WHERE email = ${trimmedEmail}`;
    if (user.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const isMatch = await bcrypt.compare(password, user[0].password);
    if (!isMatch) {
      return res.status(403).json({ error: "Wrong password, access denied!" });
    }

    let token;

    if (user[0].role === "Provider") {
      const settingId = await sql`
        SELECT id FROM public.appointmentsettings
        WHERE "providerEmail" = ${user[0].email}
      `;
      token = jwt.sign(
        {
          email: user[0].email,
          name: user[0].name,
          role: user[0].role,
          settingId: settingId.length > 0 ? settingId[0].id : 0,
        },
        process.env.JWT_SECRET,
        { expiresIn: "7d" }
      );
    } else {
      token = jwt.sign(
        {
          email: user[0].email,
          name: user[0].name,
          role: user[0].role,
          settingId: 0,
        },
        process.env.JWT_SECRET,
        { expiresIn: "7d" }
      );
    }

    return res.status(200).json({ message: "Login successful!", token: token });
  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json({ error: "Something went wrong" });
  }
});

app.post("/signup", async (req, res) => {
  try {
    const { firstName, lastName, email, password, role } = req.body;

    if (!firstName || !lastName || !email || !password || !role) {
      return res.status(400).json({ error: "All fields are required." });
    }

    const existingUser = await sql`
      SELECT * FROM public.users WHERE email = ${email.toLowerCase().trim()}
    `;
    if (existingUser.length > 0) {
      return res.status(409).json({ error: "User with that email already exists." });
    }

    const name = `${firstName.trim()} ${lastName.trim()}`;

    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = await sql`
      INSERT INTO public.users (name, email, password, role) 
      VALUES (${name}, ${email.toLowerCase().trim()}, ${hashedPassword}, ${role}) 
      RETURNING *;
    `;

    let token = 0;

    if (role === "Provider") {
      const settingId = await sql`INSERT INTO public.appointmentsettings ("providerEmail", "openingTime", "closingTime", "appointmentDuration", "lastAppointmentTime", type)
          VALUES (${email},null, null, null, null, 'Static')
          RETURNING id;`;
      token = jwt.sign(
        {
          email: newUser[0].email,
          name: newUser[0].name,
          role: newUser[0].role,
          settingId: settingId[0].id,
        },
        process.env.JWT_SECRET,
        { expiresIn: "7d" }
      );
    } else {
      token = jwt.sign(
        {
          email: newUser[0].email,
          name: newUser[0].name,
          role: newUser[0].role,
          id: 0,
        },
        process.env.JWT_SECRET,
        { expiresIn: "7d" }
      );
    }

    sendEmail(
      email,
      `Here is your sign up link!:  <a  href="${process.env.FRONT_URL}/Dashboard/?firstlogin=${token}">link</a>`,
      `Welcome To Appointy!`
    );
    res.status(201).json({ message: "User registered successfully!" });
  } catch (error) {
    console.error("Error:", error);
    return res.status(500).json({ error: "Something went wrong." });
  }
});

app.get("/check-token", verifyToken, (req, res) => {
  return res.status(200).json({ message: "Tken is valid" });
});

app.patch("/change-pass", verifyToken, async (req, res) => {
  const { password, newPassword } = req.body;

  try {
    const user = await sql`SELECT * FROM public.users WHERE email = ${req.user.email}`;
    if (user.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const isMatch = await bcrypt.compare(password, user[0].password);
    if (!isMatch) {
      return res.status(403).json({ error: "Wrong password, access denied!" });
    }

    if (!newPassword || newPassword.trim() === "") {
      return res.status(400).json({ error: "New password is required" });
    }

    const hashedNewPassword = await bcrypt.hash(newPassword, 10);

    await sql`UPDATE public.users SET password = ${hashedNewPassword} WHERE email = ${req.user.email}`;

    return res.status(200).json({ message: "Password updated successfully" });
  } catch (error) {
    console.error("Error in updating password:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/appointments-user", verifyToken, async (req, res) => {
  try {
    let appointments = [];
    if (req.user.role === "Provider") {
      appointments = await sql`
      SELECT a.id, a."recipientEmail",a."status", a."date", a."startTime", a."endTime", a."note", u."name"
      FROM public.appointments a
      JOIN public.users u
      ON a."recipientEmail" = u."email"
      WHERE a."providerEmail" = ${req.user.email}
    `;
    } else {
      appointments = await sql`
      SELECT a.id, a."providerEmail",a."status", a."date", a."startTime", a."endTime", a."note", u."name"
      FROM public.appointments a
      JOIN public.users u
      ON a."providerEmail" = u."email"
      WHERE a."recipientEmail" = ${req.user.email}
    `;
    }

    if (!appointments || appointments.length === 0) {
      return res.status(404).json({ Message: "No appointments were found" });
    }
    res.status(200).json(appointments);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "internal server error" });
  }
});

app.patch("/change-status", verifyToken, async (req, res) => {
  const validStatuses = ["Waiting", "Reserved", "Completed", "Cancelled"];
  try {
    const { status, id } = req.body;
    if (
      typeof status !== "string" ||
      typeof id !== "number" ||
      !validStatuses.includes(status)
    ) {
      console.log("Invalid inputs:", { status, id });
      return res.status(400).json({ message: "Invalid inputs" });
    }

    const appointment = await sql`
      UPDATE appointments 
      SET status = ${status} 
      WHERE id = ${id} 
      RETURNING *
    `;
    if (!appointment || appointment.length === 0) {
      console.log("Appointment not found for id:", id);
      return res.status(404).json({ message: "Appointment not found" });
    }

    res.status(200).json(appointment[0]);
  } catch (error) {
    console.error("Error updating status:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

app.get("/getappointmentsetting/:id", verifyToken, async (req, res) => {
  try {
    const id = req.params.id;
    const setting = await sql`SELECT * FROM public.appointmentsettings WHERE id = ${id}`;

    if (setting.length === 0) {
      return res.status(404).json({ error: "Appointment setting not found" });
    }

    return res.status(200).json(setting[0]);
  } catch (error) {
    console.error("Error fetching appointment setting:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

app.patch("/update-Appointment-Settings/:id", async (req, res) => {
  try {
    const { openingTime, closingTime, appointmentDuration, type } = req.body;
    const id = req.params.id;

    if (!id) {
      return res.status(400).json({
        error: "Missing appointment settings ID",
      });
    }

    if (!openingTime || !closingTime || !appointmentDuration || !type) {
      return res.status(400).json({
        error: "Missing required fields",
        details: "openingTime, closingTime, appointmentDuration, and type are required",
      });
    }

    const result = await sql`
      UPDATE appointmentsettings 
      SET "openingTime" = ${openingTime}, 
          "closingTime" = ${closingTime}, 
          "appointmentDuration" = ${appointmentDuration}, 
          type = ${type},
          "lastAppointmentTime" = ${openingTime}
      WHERE "id" = ${id}
      RETURNING *`;

    if (!result || result.length === 0) {
      return res.status(404).json({
        error: "Appointment settings not found",
        details: `No settings found with ID: ${id}`,
      });
    }

    return res.status(200).json({
      message: "Settings updated successfully",
      data: result[0],
    });
  } catch (error) {
    console.error("Error updating appointment settings:", error);
    return res.status(500).json({
      error: "Internal server error",
      details: "An unexpected error occurred while updating settings",
    });
  }
});

function addTime(startTime, minutesToAdd) {
  const [hours, minutes, seconds] = startTime.split(":").map(Number);
  let totalMinutes = hours * 60 + minutes + minutesToAdd;
  const newHours = Math.floor(totalMinutes / 60) % 24;
  const newMinutes = totalMinutes % 60;
  const formattedHours = String(newHours).padStart(2, "0");
  const formattedMinutes = String(newMinutes).padStart(2, "0");
  const formattedSeconds = String(seconds).padStart(2, "0");
  return `${formattedHours}:${formattedMinutes}:${formattedSeconds}`;
}

app.post("/add-auto-appointment/:id", verifyToken, async (req, res) => {
  const id = req.params.id;

  try {
    const setting = await sql`SELECT * FROM appointmentsettings WHERE id = ${id}`;

    if (!setting || setting.length === 0) {
      return res.status(404).json({ error: "Appointment settings not found" });
    }

    if (!setting[0].lastAppointmentTime || !setting[0].appointmentDuration) {
      return res.status(400).json({ error: "Missing required settings" });
    }

    const startTime = setting[0].lastAppointmentTime;
    const endTime = addTime(startTime, setting[0].appointmentDuration);

    console.log("Start Time:", startTime);
    console.log("End Time:", endTime);

    await sql`INSERT INTO appointments ("providerEmail", "recipientEmail", date, "startTime", "endTime", status)
      SELECT 
        (SELECT "providerEmail" FROM appointmentsettings WHERE id = ${id}) AS "providerEmail",
        ${req.user.email},
        CURRENT_DATE,
        ${startTime}::time,
        ${endTime}::time,
        'Reserved'
      ;`;

    const result = await sql`
      UPDATE appointmentsettings 
      SET  
        "lastAppointmentTime" = ${endTime}::time
      WHERE "id" = ${id}
      RETURNING *`;

    res.status(201).json({ message: "Appointment added successfully", data: result });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: "Something went wrong" });
  }
});

app.post("/add-static-appointment/:id", verifyToken, async (req, res) => {
  const id = req.params.id;
  const { date } = req.body; 
  try {
    await sql`INSERT INTO appointments ("providerEmail", "recipientEmail", "date", "status")
      SELECT 
        (SELECT "providerEmail" FROM appointmentsettings WHERE id = ${id}) AS "providerEmail",
        ${req.user.email},
        ${date}::date,
        'Waiting'
      ;`;
    res.status(201).json({ message: "Static appointment added successfully" });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: "Something went wrong" });
  }
});

function endOfDay() {
  scheduleJob('59 54 23 * * *', async () => {
    await sql`UPDATE appointments SET "status" = 'Completed' WHERE "date" = CURRENT_DATE`;
    await sql`UPDATE appointmentsettings SET "lastAppointmentTime" = "openingTime"`;
    console.log("End of day: Appointments completed and times reset");
  });
}

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(3000, () => {
  console.log("Server running at http://localhost:3000");
});