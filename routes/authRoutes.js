const express = require("express");

console.log("AUTH ROUTE FILE UPDATED");

const router = express.Router();

router.get("/register", (req, res) => {
    res.send("REGISTER WORKING 100%");
});

module.exports = router;