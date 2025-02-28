import nodeMailer from "nodemailer";
import dotenv from "dotenv";
dotenv.config();

const transporter = nodeMailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL, 
      pass: process.env.PASSWORD    
    }
  });

  async function sendEmail(userEmail, message, subject) {
    try {
      const mailOptions = {
        from: `"Appointy" <${process.env.EMAIL}>`,
        to: userEmail,                                 
        subject: `${subject}`,             
        text: `${message}`,
        html: `<h1" >Appointy</h1><p>${message}</p>` 
      };

      const info = await transporter.sendMail(mailOptions);
      console.log('Email sent: ' + info.response);
    } catch (error) {
      console.error('Error sending email: ', error);
    }
  }

  export default sendEmail;
  
 