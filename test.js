import express from "express";
import fs from "fs";
import path from "path";

const app = express();

app.delete("/delete-invoices", async (req, res) => {
  try {
    // Invoice folder ka path
    const folderPath = path.join(
      __dirname,
      "public_html/UserData/Invoices/Processed_Invoices/"
    );

    // Folder ke andar sari files padho
    fs.readdir(folderPath, (err, files) => {
      if (err) {
        return res.status(500).json({ message: "Folder read error", error: err });
      }

      // Har file delete karo
      files.forEach((file) => {
        fs.unlink(path.join(folderPath, file), (err) => {
          if (err) {
            console.error("Error deleting file:", file, err);
          }
        });
      });

      return res.status(200).json({ message: "All invoices deleted from folder" });
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error });
  }
});

app.listen(5000, () => console.log("Server running on port 5000"));
