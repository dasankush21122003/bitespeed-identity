import express from "express";
import { PrismaClient } from "@prisma/client";

const app = express();
const prisma = new PrismaClient();

app.use(express.json());

app.get("/", (req, res) => {
  res.send("Server is running 🚀");
});

app.get("/contacts", async (req, res) => {
  const contacts = await prisma.contact.findMany();
  res.json(contacts);
});

app.post("/identify", async (req, res) => {
  const { email, phoneNumber } = req.body;

  if (!email && !phoneNumber) {
    return res.status(400).json({ error: "Email or phoneNumber required" });
  }

  // 1️⃣ Find all contacts that match email or phone
  let matchedContacts = await prisma.contact.findMany({
    where: {
      OR: [
        { email: email ?? undefined },
        { phoneNumber: phoneNumber ?? undefined }
      ]
    },
    orderBy: { createdAt: "asc" }
  });

  // 2️⃣ If none found → create new primary
  if (matchedContacts.length === 0) {
    const newContact = await prisma.contact.create({
      data: {
        email,
        phoneNumber,
        linkPrecedence: "primary"
      }
    });

    return res.json({
      contact: {
        primaryContactId: newContact.id,
        emails: email ? [email] : [],
        phoneNumbers: phoneNumber ? [phoneNumber] : [],
        secondaryContactIds: []
      }
    });
  }

  // 3️⃣ Get all root primary IDs involved
  const rootPrimaryIds = new Set<number>();

  for (const contact of matchedContacts) {
    if (contact.linkPrecedence === "primary") {
      rootPrimaryIds.add(contact.id);
    } else if (contact.linkedId) {
      rootPrimaryIds.add(contact.linkedId);
    }
  }

  // 4️⃣ Fetch all primary contacts involved
  const primaryContacts = await prisma.contact.findMany({
    where: { id: { in: Array.from(rootPrimaryIds) } },
    orderBy: { createdAt: "asc" }
  });

  // Oldest becomes main primary
  const mainPrimary = primaryContacts[0];

  // 5️⃣ Convert other primaries to secondary
  for (const primary of primaryContacts) {
    if (primary.id !== mainPrimary.id) {
      await prisma.contact.update({
        where: { id: primary.id },
        data: {
          linkPrecedence: "secondary",
          linkedId: mainPrimary.id
        }
      });
    }
  }

  // 6️⃣ Create new secondary if exact combination doesn't exist
  const exactMatch = await prisma.contact.findFirst({
    where: {
      email: email ?? undefined,
      phoneNumber: phoneNumber ?? undefined
    }
  });

  if (!exactMatch) {
    await prisma.contact.create({
      data: {
        email,
        phoneNumber,
        linkPrecedence: "secondary",
        linkedId: mainPrimary.id
      }
    });
  }

  // 7️⃣ Fetch ALL contacts linked to main primary
  const finalContacts = await prisma.contact.findMany({
    where: {
      OR: [
        { id: mainPrimary.id },
        { linkedId: mainPrimary.id }
      ]
    }
  });

  const emails = [
    ...new Set(finalContacts.map(c => c.email).filter(Boolean))
  ];

  const phoneNumbers = [
    ...new Set(finalContacts.map(c => c.phoneNumber).filter(Boolean))
  ];

  const secondaryContactIds = finalContacts
    .filter(c => c.linkPrecedence === "secondary")
    .map(c => c.id);

  return res.json({
    contact: {
      primaryContactId: mainPrimary.id,
      emails,
      phoneNumbers,
      secondaryContactIds
    }
  });
});

const PORT = 3000;

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});