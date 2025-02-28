import jwt from "jsonwebtoken";

const verifyToken = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: "Authorization header missing" });
    
  }

  const token = authHeader.split(" ")[1];
  if (!token) {
    console.log("Token missing")
    return res.status(401).json({ error: "Token missing" });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).json({ error: "Token is invalid or expired" });
    }
    req.user = decoded;
    next();
  });
};

export default verifyToken;
