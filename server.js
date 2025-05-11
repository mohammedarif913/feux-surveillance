// server.js
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mqtt = require('mqtt');
const mysql = require('mysql');
const cors = require('cors');
const nodemailer = require('nodemailer');

// Flag pour suivre l'état d'arrêt
let isShuttingDown = false;

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Activer CORS pour permettre les requêtes cross-origin
app.use(cors());

// Pour parser le JSON
app.use(express.json());

// Configuration de la connexion MySQL
const db = mysql.createConnection({
  host: 'localhost',
  user: 'root',
  password: '2003',
  database: 'prajot'
});

db.connect((err) => {
  if (err) {
    console.error("Erreur DB :", err);
    process.exit(1);
  }
  console.log("Connecté à MySQL");
});

// Configuration du transporteur d'email
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'surveillancefeux@gmail.com',
    pass: 'lbtb lwnj eqzz xdmb'
  }
});

// Connexion au broker MQTT
const mqttClient = mqtt.connect('mqtt://localhost');

mqttClient.on('connect', () => {
  console.log("Client MQTT connecté");
  mqttClient.subscribe('feux/etat', (err) => {
    if (err) {
      console.error("Erreur d'abonnement :", err);
    } else {
      console.log('Abonné au topic "feux/etat"');
    }
  });
  
  // S'abonner au topic de confirmation des commandes
  mqttClient.subscribe('feux/commande/confirmation', (err) => {
    if (err) {
      console.error("Erreur d'abonnement aux confirmations :", err);
    } else {
      console.log('Abonné au topic "feux/commande/confirmation"');
    }
  });
  
  // S'abonner au topic d'erreur des commandes
  mqttClient.subscribe('feux/commande/erreur', (err) => {
    if (err) {
      console.error("Erreur d'abonnement aux erreurs :", err);
    } else {
      console.log('Abonné au topic "feux/commande/erreur"');
    }
  });

  // S'abonner au topic de commande directe (pour le contrôle bidirectionnel)
  mqttClient.subscribe('feux/commande', (err) => {
    if (err) {
      console.error("Erreur d'abonnement aux commandes :", err);
    } else {
      console.log('Abonné au topic "feux/commande"');
    }
  });
});

// Remplacez votre Set par un Map qui stockera ID du feu -> types d'anomalies
const anomaliesSignalees = new Map();

// Compteur pour le suivi des appels
let compteurVerifications = 0;
let compteurEmails = 0;

function verifierDonneesAnormales(feu) {
  // Vérifier si le serveur est en cours d'arrêt
  if (isShuttingDown) return null;
  
  // Incrémenter le compteur
  compteurVerifications++;
  const idVerification = compteurVerifications;
  
  console.log(`[DEBUG-${idVerification}] DÉBUT vérification pour le feu: ${feu.id || feu.ID}`);
  console.log(`[DEBUG-${idVerification}] Propriétés disponibles: ${Object.keys(feu).join(', ')}`);
  
  const feuId = feu.id || feu.ID;
  
  // Afficher l'état actuel de la map des anomalies
  console.log(`[DEBUG-${idVerification}] État actuel des anomalies signalées:`);
  for (const [id, anomalies] of anomaliesSignalees.entries()) {
    console.log(`[DEBUG-${idVerification}]   - Feu ${id}: ${[...anomalies].join(', ')}`);
  }
  
  // Créer un ensemble d'anomalies courantes
  const anomaliesCourantes = new Set();
  
  // Vérifier les différents types d'anomalies
  if ((feu.tension_service && feu.tension_service.includes('5V')) || 
      (feu.Tension_service && feu.Tension_service.includes('5V'))) {
    anomaliesCourantes.add("tension");
    console.log(`[DEBUG-${idVerification}] Anomalie de tension détectée: ${feu.tension_service || feu.Tension_service}`);
  }
  
  if ((feu.optiqueCentre === 'NOK') || 
      (feu.optiqueHaut === 'NOK') || 
      (feu.optiqueBas === 'NOK') ||
      (feu.Etat_optique_central === 'NOK') || 
      (feu.Etat_optique_haut === 'NOK') || 
      (feu.Etat_optique_bas === 'NOK')) {
    anomaliesCourantes.add("optique");
    console.log(`[DEBUG-${idVerification}] Anomalie optique détectée: optiqueCentre=${feu.optiqueCentre}, optiqueHaut=${feu.optiqueHaut}, optiqueBas=${feu.optiqueBas}`);
  }
  
  const autonomie = feu.autonomie || feu.Autonomie;
  if (autonomie && autonomie.includes('h')) {
    const heures = parseInt(autonomie);
    if (!isNaN(heures) && heures < 5) {
      anomaliesCourantes.add("autonomie");
      console.log(`[DEBUG-${idVerification}] Autonomie critique détectée: ${autonomie}`);
    }
  }
  
  console.log(`[DEBUG-${idVerification}] Anomalies courantes: ${[...anomaliesCourantes].join(', ') || 'aucune'}`);
  
  // Obtenir les anomalies précédentes (si elles existent)
  const anomaliesPrecedentes = anomaliesSignalees.get(feuId) || new Set();
  console.log(`[DEBUG-${idVerification}] Anomalies précédentes: ${[...anomaliesPrecedentes].join(', ') || 'aucune'}`);
  
  // Déterminer les nouvelles anomalies
  const nouvellesAnomalies = new Set(
    [...anomaliesCourantes].filter(type => !anomaliesPrecedentes.has(type))
  );
  console.log(`[DEBUG-${idVerification}] Nouvelles anomalies: ${[...nouvellesAnomalies].join(', ') || 'aucune'}`);
  
  // Déterminer les anomalies résolues
  const anomaliesResolues = new Set(
    [...anomaliesPrecedentes].filter(type => !anomaliesCourantes.has(type))
  );
  console.log(`[DEBUG-${idVerification}] Anomalies résolues: ${[...anomaliesResolues].join(', ') || 'aucune'}`);
  
  // Variable pour suivre si un email a été envoyé
  let emailEnvoye = false;
  
  // Si nous avons de nouvelles anomalies, envoyer un email
  if (nouvellesAnomalies.size > 0) {
    // Construire le message d'anomalie
    const messages = [];
    if (nouvellesAnomalies.has("tension")) {
      messages.push("Tension de service anormale: " + (feu.tension_service || feu.Tension_service));
    }
    if (nouvellesAnomalies.has("optique")) {
      messages.push("État optique défectueux détecté");
    }
    if (nouvellesAnomalies.has("autonomie")) {
      messages.push("Autonomie critique: " + (feu.autonomie || feu.Autonomie));
    }
    
    const messageAnomalie = messages.join(", ");
    console.log(`[DEBUG-${idVerification}] ALERTE! Nouvelles anomalies pour ${feuId}: ${messageAnomalie}`);
    
    // Incrémenter le compteur d'emails
    compteurEmails++;
    console.log(`[DEBUG-${idVerification}] Préparation de l'envoi d'email #${compteurEmails} pour ${feuId}`);
    
    try {
      // Envoyer l'alerte par email
      envoyerAlerte(feu, messageAnomalie);
      emailEnvoye = true;
      console.log(`[DEBUG-${idVerification}] Email #${compteurEmails} envoyé avec succès pour ${feuId}`);
    } catch (error) {
      console.error(`[DEBUG-${idVerification}] ERREUR lors de l'envoi de l'email: ${error.message}`);
    }
    
    // Envoyer l'alerte au frontend
    try {
      io.emit('feu_anomalie', {
        id: feuId,
        type: 'anomalie',
        message: messageAnomalie,
        details: feu,
        timestamp: new Date().toISOString()
      });
      console.log(`[DEBUG-${idVerification}] Notification frontend envoyée pour ${feuId}`);
    } catch (error) {
      console.error(`[DEBUG-${idVerification}] ERREUR lors de l'envoi de la notification: ${error.message}`);
    }
  }
  
  // Si nous avons des anomalies résolues, envoyer une notification
  if (anomaliesResolues.size > 0) {
    // Construire le message de résolution
    const messages = [];
    if (anomaliesResolues.has("tension")) {
      messages.push("Tension de service normalisée");
    }
    if (anomaliesResolues.has("optique")) {
      messages.push("État optique rétabli");
    }
    if (anomaliesResolues.has("autonomie")) {
      messages.push("Autonomie rétablie");
    }
    
    const messageResolution = messages.join(", ");
    console.log(`[DEBUG-${idVerification}] RÉSOLUTION! Anomalies résolues pour ${feuId}: ${messageResolution}`);
    
    // Envoyer la notification au frontend
    try {
      io.emit('feu_resolution', {
        id: feuId,
        type: 'resolution',
        message: messageResolution,
        details: feu,
        timestamp: new Date().toISOString()
      });
      console.log(`[DEBUG-${idVerification}] Notification de résolution envoyée pour ${feuId}`);
    } catch (error) {
      console.error(`[DEBUG-${idVerification}] ERREUR lors de l'envoi de la notification de résolution: ${error.message}`);
    }
    
    // Option: Envoyer un email de résolution
    // envoyerNotificationResolution(feu, messageResolution);
  }
  
  // Mettre à jour les anomalies signalées
  if (anomaliesCourantes.size > 0) {
    anomaliesSignalees.set(feuId, anomaliesCourantes);
    console.log(`[DEBUG-${idVerification}] Mise à jour des anomalies connues pour ${feuId}: ${[...anomaliesCourantes].join(', ')}`);
  } else if (anomaliesPrecedentes.size > 0) {
    // Si plus d'anomalies, supprimer l'entrée
    anomaliesSignalees.delete(feuId);
    console.log(`[DEBUG-${idVerification}] Suppression de ${feuId} de la liste des anomalies connues`);
  }
  
  console.log(`[DEBUG-${idVerification}] FIN vérification pour ${feuId}`);
  
  // Retourner un objet avec plus d'informations pour permettre au code appelant
  // de savoir si un email a déjà été envoyé
  if (anomaliesCourantes.size > 0) {
    return {
      message: "Anomalies: " + [...anomaliesCourantes].join(", "),
      emailEnvoye: emailEnvoye,
      nouvellesAnomalies: [...nouvellesAnomalies],
      anomaliesResolues: [...anomaliesResolues]
    };
  } else {
    return null;
  }
}

// Fonction pour envoyer un email d'alerte
function envoyerAlerte(feu, raison) {
  // Vérifier si le serveur est en cours d'arrêt
  if (isShuttingDown) return;
  
  // Déterminer à quelle entreprise envoyer l'alerte
  const entreprise = feu.owner || feu.IDE || 'system';
  
  // Obtenir l'email de l'entreprise depuis la base de données
  const sql = "SELECT email FROM Entreprise WHERE ID = ?";
  
  db.query(sql, [entreprise], (err, results) => {
    if (err) {
      console.error("Erreur lors de la récupération de l'email:", err);
      return;
    }
    
    if (results.length === 0) {
      console.log(`Aucune adresse email trouvée pour l'entreprise ${entreprise}`);
      return;
    }
    
    const emailDestinataire = results[0].email;
    
    // Configurer l'email
    const mailOptions = {
      from: 'surveillancefeux@gmail.com',
      to: emailDestinataire,
      subject: `ALERTE: Anomalie détectée sur le feu ${feu.ID || feu.id}`,
      html: `
        <h2>Alerte: Anomalie technique détectée</h2>
        <p><strong>ID du feu:</strong> ${feu.ID || feu.id}</p>
        <p><strong>Raison de l'alerte:</strong> ${raison}</p>
        <p><strong>Détails du feu:</strong></p>
        <ul>
          <li>Position: ${feu.Position_Géo || 'Non spécifiée'}</li>
          <li>Position physique: ${feu.Position_Physique || feu.posPhysique || 'Non spécifiée'}</li>
          <li>Tension de service: ${feu.Tension_service || 'Non spécifiée'}</li>
          <li>État optique haut: ${feu.Etat_optique_haut || feu.optiqueHaut || 'Non spécifié'}</li>
          <li>État optique central: ${feu.Etat_optique_central || feu.optiqueCentre || 'Non spécifié'}</li>
          <li>État optique bas: ${feu.Etat_optique_bas || feu.optiqueBas || 'Non spécifié'}</li>
          <li>Autonomie: ${feu.Autonomie || feu.autonomie || 'Non spécifiée'}</li>
        </ul>
        <p>Veuillez prendre les mesures nécessaires pour résoudre ce problème.</p>
      `
    };
    
    // Envoyer l'email
    transporter.sendMail(mailOptions, (error, info) => {
      if (error) {
        console.error("Erreur d'envoi d'email:", error);
      } else {
        console.log('Email envoyé:', info.response);
      }
    });
  });
}

mqttClient.on('message', (topic, message) => {
  // Vérifier si le serveur est en cours d'arrêt
  if (isShuttingDown) return;
  
  if (topic === 'feux/etat') {
    processFeuxEtat(message);
  } 
  else if (topic === 'feux/commande/confirmation') {
    processCommandeConfirmation(message);
  }
  else if (topic === 'feux/commande/erreur') {
    processCommandeErreur(message);
  }
  else if (topic === 'feux/commande') {
    // Ce bloc est optionnel - normalement le serveur envoie des commandes
    // mais ne les reçoit pas directement depuis MQTT, sauf si d'autres systèmes
    // envoient aussi des commandes
    console.log("Commande MQTT reçue:", message.toString());
  }
});

// Traitement des messages d'état des feux
function processFeuxEtat(message) {
  // Vérifier si le serveur est en cours d'arrêt
  if (isShuttingDown) return;
  
  let payload;
  try {
    payload = JSON.parse(message.toString());
  } catch (error) {
    console.error("Erreur de parsing JSON :", error);
    return;
  }
  
  // On récupère les coordonnées depuis payload.localisation si défini, sinon payload.latitude/longitude
  const lat = payload.localisation && payload.localisation.lat ? payload.localisation.lat : payload.latitude;
  const lng = payload.localisation && payload.localisation.lng ? payload.localisation.lng : payload.longitude;
  
  // Vérifier si le feu existe déjà dans la table "FEUX"
  const selectSql = "SELECT ID, IDE FROM FEUX WHERE ID = ?";
  db.query(selectSql, [payload.id], (err, results) => {
    if (err) {
      console.error("Erreur lors de la récupération du feu :", err);
      return;
    }
    if (results.length === 0) {
      // Le feu n'existe pas, insertion d'un nouveau record
      console.log("Feu non trouvé, insertion d'un nouveau record pour :", payload.id);
      const insertSql = `
        INSERT INTO FEUX 
          (ID, Pays, Tension_service, Tension_alimentation, Luminosité, 
           Temps, Autonomie, Mode, Num_cycle, Table_cycle, 
           Etat_optique_haut, Etat_optique_bas, Etat_optique_central, 
           Position_Géo, Position_Physique, Radio, Bluetooth, IDE)
        VALUES 
          (?, ?, ?, ?, 100, 
           ?, ?, ?, ?, ?, 
           ?, ?, ?, 
           ?, ?, ?, ?, ?)
      `;
      db.query(insertSql, [
        payload.id,
        payload.pays || 'FR',
        payload.tension_service || '12V DC',
        payload.tension_alim || '12V DC',
        payload.tempsFonction || '0h',
        payload.autonomie || '0h',
        payload.mode || 'Fixe',
        payload.cycles_count ? payload.cycles_count.toString() : '0',
        payload.tableCycle ? payload.tableCycle.toString() : '1',
        payload.optiqueHaut || 'OK',
        payload.optiqueBas || 'OK',
        payload.optiqueCentre || 'OK',
        `${lat},${lng}`,
        payload.posPhysique || 'Inconnu',
        payload.radio ? 'oui' : 'non',
        payload.bluetooth ? 'oui' : 'non',
        payload.owner || 'system'
      ], (err, insertResult) => {
        if (err) {
          console.error("Erreur d'insertion dans FEUX :", err);
          return;
        }
        console.log("Insertion réussie pour", payload.id);
        
        // Insérer dans l'historique pour un nouveau feu
        const insertHistorique = `
          INSERT INTO FEUX_HISTORIQUE 
            (feu_id, etat_precedent, etat_courant, date_changement)
          VALUES 
            (?, ?, ?, NOW())
        `;
        
        db.query(insertHistorique, [
          payload.id,
          null, // Premier état, pas d'état précédent
          payload.etat_courant
        ], (err) => {
          if (err) {
            console.error("Erreur d'insertion dans l'historique (nouveau feu) :", err);
          } else {
            console.log(`Premier état enregistré pour ${payload.id}: null -> ${payload.etat_courant}`);
          }
        });
      });
    } else {
      // Le feu existe, mise à jour de ses propriétés
      // Conserver l'IDE existant si aucun owner n'est spécifié
      const currentIDE = results[0].IDE;
      
      // Construire la requête SQL sans modifier l'IDE si non nécessaire
      let updateSql = `
        UPDATE FEUX 
        SET Pays = ?, 
            Tension_service = ?, 
            Tension_alimentation = ?, 
            Temps = ?, 
            Autonomie = ?, 
            Mode = ?, 
            Num_cycle = ?, 
            Table_cycle = ?, 
            Etat_optique_haut = ?, 
            Etat_optique_bas = ?, 
            Etat_optique_central = ?, 
            Position_Géo = ?, 
            Position_Physique = ?, 
            Radio = ?, 
            Bluetooth = ?
      `;
      
      // Préparer les paramètres de base
      const params = [
        payload.pays || 'FR',
        payload.tension_service || '12V DC',
        payload.tension_alim || '12V DC',
        payload.tempsFonction || '0h',
        payload.autonomie || '0h',
        payload.mode || 'Fixe',
        payload.cycles_count ? payload.cycles_count.toString() : '0',
        payload.tableCycle ? payload.tableCycle.toString() : '1',
        payload.optiqueHaut || 'OK',
        payload.optiqueBas || 'OK',
        payload.optiqueCentre || 'OK',
        `${lat},${lng}`,
        payload.posPhysique || 'Inconnu',
        payload.radio ? 'oui' : 'non',
        payload.bluetooth ? 'oui' : 'non'
      ];
      
      // Ne mettre à jour IDE que si owner est défini explicitement
      if (payload.owner && (!currentIDE || currentIDE === 'system')) {
        updateSql += ', IDE = ?';
        params.push(payload.owner);
        console.log(`Mise à jour IDE pour ${payload.id}: ${currentIDE} -> ${payload.owner}`);
      } else {
        console.log(`Conservation IDE existant pour ${payload.id}: ${currentIDE}`);
      }
      
      // Terminer la requête
      updateSql += ' WHERE ID = ?';
      params.push(payload.id);
      
      db.query(updateSql, params, (err, updateResult) => {
        if (err) {
          console.error("Erreur de mise à jour DB :", err);
          return;
        }
        console.log(`Mise à jour effectuée pour ${payload.id}`);
        
        // Insérer dans l'historique après mise à jour
        const insertHistorique = `
          INSERT INTO FEUX_HISTORIQUE 
            (feu_id, etat_precedent, etat_courant, date_changement)
          VALUES 
            (?, ?, ?, NOW())
        `;
        
        // D'abord récupérer l'état précédent le plus récent
        db.query("SELECT etat_courant FROM FEUX_HISTORIQUE WHERE feu_id = ? ORDER BY date_changement DESC LIMIT 1", 
          [payload.id], (err, results) => {
            // État précédent ou null si c'est la première entrée
            const etatPrecedent = results && results.length > 0 ? results[0].etat_courant : null;
            
            // Puis insérer la nouvelle entrée dans l'historique seulement si l'état a changé
            if (etatPrecedent !== payload.etat_courant) {
              db.query(insertHistorique, [
                payload.id,
                etatPrecedent,
                payload.etat_courant
              ], (err) => {
                if (err) {
                  console.error("Erreur d'insertion dans l'historique :", err);
                } else {
                  console.log(`Historique enregistré pour ${payload.id}: ${etatPrecedent} -> ${payload.etat_courant}`);
                }
              });
            }
        });
        
        // Notifier les clients via Socket.IO
        const selectUpdatedSql = "SELECT * FROM FEUX WHERE ID = ?";
        db.query(selectUpdatedSql, [payload.id], (err, rows) => {
          if (err) {
            console.error("Erreur lors de la récupération du feu mis à jour :", err);
            return;
          }
          if (rows.length > 0) {
            // Ajouter des propriétés supplémentaires pour compatibilité
            const feuData = rows[0];
            feuData.etat_courant = payload.etat_courant;
            feuData.nom = payload.nom || `Feu ${payload.id}`;
            feuData.type = payload.type || "Tricolore";
            feuData.dernier_changement = payload.dernier_changement || new Date().toISOString();
            feuData.latitude = lat;
            feuData.longitude = lng;
            
            io.emit('update_feu', feuData);
          }
        });
      });
    }
  });
 
  // Vérifier si les données sont anormales
  const anomalie = verifierDonneesAnormales(payload);
  if (anomalie) {
    console.log(`Anomalie détectée pour le feu ${payload.id}: ${anomalie}`);
    //envoyerAlerte(payload, anomalie);
  }
 }

// Traitement des confirmations de commandes
function processCommandeConfirmation(message) {
  // Vérifier si le serveur est en cours d'arrêt
  if (isShuttingDown) return;
  
  try {
    const confirmation = JSON.parse(message.toString());
    console.log("Confirmation de commande reçue:", confirmation);
    
    // Mise à jour du statut de la commande en base de données
    const updateSql = `
      UPDATE FEUX_COMMANDES 
      SET statut = ?, date_execution = NOW() 
      WHERE feu_id = ? AND id = ?
    `;
    
    db.query(updateSql, [
      confirmation.statut || 'exécutée',
      confirmation.id,
      confirmation.commande_id
    ], (err, result) => {
      if (err) {
        console.error("Erreur lors de la mise à jour du statut de la commande:", err);
      } else if (result.affectedRows === 0) {
        console.warn(`Aucune commande trouvée pour la confirmation: ${confirmation.id}, ${confirmation.commande_id}`);
      } else {
        console.log(`Statut de la commande mis à jour: ${confirmation.id}, ${confirmation.commande_id}`);
        
        // Notifier les clients via Socket.IO
        io.emit('commande_confirmation', confirmation);
        
        // Également émettre le format command_confirmed pour compatibilité avec l'interface améliorée
        io.emit('command_confirmed', {
          id: confirmation.id,
          newState: confirmation.etat_cible || confirmation.newState,
          message: 'État du feu modifié avec succès'
        });
      }
    });
  } catch (error) {
    console.error("Erreur de parsing JSON (confirmation) :", error);
  }
}

// Traitement des erreurs de commandes
function processCommandeErreur(message) {
  // Vérifier si le serveur est en cours d'arrêt
  if (isShuttingDown) return;
  
  try {
    const erreur = JSON.parse(message.toString());
    console.log("Erreur de commande reçue:", erreur);
    
    // Mise à jour du statut de la commande en base de données
    const updateSql = `
      UPDATE FEUX_COMMANDES 
      SET statut = 'erreur' 
      WHERE feu_id = ? AND id = ?
    `;
    
    db.query(updateSql, [
      erreur.id,
      erreur.commande_id
    ], (err, result) => {
      if (err) {
        console.error("Erreur lors de la mise à jour du statut d'erreur de la commande:", err);
      } else {
        console.log(`Statut d'erreur de la commande mis à jour: ${erreur.id}, ${erreur.commande_id}`);
        
        // Notifier les clients via Socket.IO
        io.emit('commande_erreur', erreur);
        
        // Également émettre le format command_error pour compatibilité avec l'interface améliorée
        io.emit('command_error', {
          id: erreur.id,
          error: erreur.message || 'Erreur lors de l exécution de la commande' });
      }
    });
  } catch (error) {
    console.error("Erreur de parsing JSON (erreur) :", error);
  }
}
app.use(express.static('public'));



// Route API pour envoyer des commandes aux feux
app.post('/api/feux/:id/commande', (req, res) => {
  // Vérifier si le serveur est en cours d'arrêt
  if (isShuttingDown) {
    return res.status(503).json({ error: "Le serveur est en cours d'arrêt" });
  }
  
  try {
    const feuId = req.params.id;
    const { commande, etat, utilisateur } = req.body;
    
    console.log("Détails de la requête:", {
      feuId,
      commande,
      etat,
      utilisateur,
      body: req.body
    });
    
    if (!commande || etat === undefined) {
      return res.status(400).json({ error: "Paramètres manquants: commande et etat sont requis" });
    }
    
    console.log(`Commande reçue pour le feu ${feuId}: ${commande}, nouvel état: ${etat}`);
    
    // D'abord, vérifier si le feu existe dans la base de données
    db.query("SELECT ID FROM FEUX WHERE ID = ?", [feuId], (err, results) => {
      if (err) {
        console.error("Erreur lors de la vérification de l'existence du feu:", err);
        return res.status(500).json({ error: "Erreur serveur: " + err.message });
      }
      
      // Si le feu n'existe pas, on crée une entrée factice
      if (results.length === 0) {
        console.log(`Le feu ${feuId} n'existe pas dans la base de données, création d'une entrée temporaire`);
        
        // Vous pourriez choisir d'envoyer directement la commande sans créer d'entrée
        // Dans ce cas, retire ce bloc et passe directement à l'insertion de la commande
      }
      
      // Enregistrer la commande dans la base de données
      const insertSql = `
        INSERT INTO FEUX_COMMANDES 
          (feu_id, commande, etat_cible, date_envoi, utilisateur)
        VALUES (?, ?, ?, NOW(), ?)
      `;
      
      db.query(insertSql, [
        feuId,
        commande,
        etat,
        utilisateur || 'system'
      ], (err, result) => {
        if (err) {
          console.error("Erreur lors de l'enregistrement de la commande:", err);
          return res.status(500).json({ error: "Erreur serveur: " + err.message });
        }
        
        const commandeId = result.insertId;
        console.log(`Commande enregistrée avec ID: ${commandeId}`);
        
        // Envoi de la commande via MQTT
        const payload = JSON.stringify({
          id: feuId,
          commande: commande,
          etat_cible: etat,
          commande_id: commandeId,
          timestamp: new Date().toISOString()
        });
        
        mqttClient.publish('feux/commande', payload, (err) => {
          if (err) {
            console.error("Erreur d'envoi de commande MQTT:", err);
            return res.status(500).json({ error: "Erreur d'envoi de commande" });
          }
          
          console.log(`Commande MQTT publiée avec succès pour ${feuId}`);
          res.json({ 
            success: true, 
            commande_id: commandeId,
            message: `Commande envoyée au feu ${feuId}` 
          });
        });
      });
    });
  } catch (error) {
    console.error("Erreur globale dans la route des commandes:", error);
    res.status(500).json({ error: "Erreur serveur interne" });
  }
});




// Route pour modifier la durée d'un état
app.post('/api/feux/:id/duree', (req, res) => {
  const feuId = req.params.id;
  const { etat, duree, utilisateur } = req.body;
  
  // Validation
  if (etat === undefined || !duree) {
    return res.status(400).json({ error: "Paramètres manquants: etat et duree sont requis" });
  }
  
  // Vérifier que la durée est valide (entre 5 et 300 secondes)
  if (duree < 5 || duree > 300) {
    return res.status(400).json({ error: "La durée doit être entre 5 et 300 secondes" });
  }
  
  // Déterminer quelle colonne mettre à jour en fonction de l'état
  let colonneAModifier;
  switch(parseInt(etat)) {
    case 0:
      colonneAModifier = 'duree_rouge';
      break;
    case 1:
      colonneAModifier = 'duree_orange';
      break;
    case 2:
      colonneAModifier = 'duree_vert';
      break;
    default:
      return res.status(400).json({ error: "État invalide" });
  }
  
  // Récupérer l'ancienne durée
  db.query(`SELECT ${colonneAModifier} as ancienne_duree FROM FEUX WHERE ID = ?`, [feuId], (err, results) => {
    if (err) {
      console.error("Erreur lors de la récupération de l'ancienne durée:", err);
      return res.status(500).json({ error: "Erreur serveur" });
    }
    
    const ancienneDuree = results[0] ? results[0].ancienne_duree : null;
    
    // Mettre à jour la durée
    db.query(`UPDATE FEUX SET ${colonneAModifier} = ? WHERE ID = ?`, [duree, feuId], (err) => {
      if (err) {
        console.error("Erreur lors de la mise à jour de la durée:", err);
        return res.status(500).json({ error: "Erreur serveur" });
      }
      
      // Enregistrer dans l'historique
      db.query(`INSERT INTO FEUX_DUREES_HISTORIQUE (feu_id, etat, ancienne_duree, nouvelle_duree, date_changement, utilisateur) 
                VALUES (?, ?, ?, ?, NOW(), ?)`, 
        [feuId, etat, ancienneDuree, duree, utilisateur || 'system'], (err) => {
          if (err) {
            console.error("Erreur lors de l'enregistrement dans l'historique:", err);
          }
          
          // Envoyer la commande via MQTT
          const payload = JSON.stringify({
            id: feuId,
            commande: 'changerDuree',
            etat: etat,
            duree: duree,
            timestamp: new Date().toISOString()
          });
          
          mqttClient.publish('feux/commande', payload);
          
          // Notifier via Socket.IO
          io.emit('duree_modifiee', {
            id: feuId,
            etat: etat,
            duree: duree,
            message: `Durée de l'état ${etat} modifiée à ${duree}s`
          });
          
          res.json({ 
            success: true, 
            message: `Durée modifiée avec succès` 
          });
        });
    });
  });
});

// Route pour récupérer les durées actuelles d'un feu
app.get('/api/feux/:id/durees', (req, res) => {
  const feuId = req.params.id;
  
  db.query(
    'SELECT duree_rouge, duree_orange, duree_vert FROM FEUX WHERE ID = ?', 
    [feuId], 
    (err, results) => {
      if (err) {
        console.error("Erreur lors de la récupération des durées:", err);
        return res.status(500).json({ error: "Erreur serveur" });
      }
      
      if (results.length === 0) {
        return res.status(404).json({ error: "Feu non trouvé" });
      }
      
      res.json({
        duree_rouge: results[0].duree_rouge,
        duree_orange: results[0].duree_orange,
        duree_vert: results[0].duree_vert
      });
    }
  );
});

// Route API pour récupérer l'historique des commandes d'un feu
app.get('/api/feux/:id/commandes', (req, res) => {
  const feuId = req.params.id;
  const { limit = 20 } = req.query;
  
  const sql = `
    SELECT * FROM FEUX_COMMANDES 
    WHERE feu_id = ? 
    ORDER BY date_envoi DESC 
    LIMIT ?
  `;
  
  db.query(sql, [feuId, parseInt(limit)], (err, rows) => {
    if (err) {
      console.error(`Erreur lors de la récupération des commandes du feu ${feuId}:`, err);
      return res.status(500).json({ error: "Erreur serveur" });
    }
    
    res.json(rows);
  });
});

app.get('/api/feux', (req, res) => {
  db.query("SELECT * FROM FEUX", (err, rows) => {
    if (err) {
      console.error("Erreur lors de la récupération des feux:", err);
      return res.status(500).json({ error: "Erreur serveur" });
    }
    
    const feux = rows.map(row => ({
      ID: row.ID,
      nom: `Feu ${row.ID}`
    }));
    
    res.json(feux);
  });
});
// Placez ce code AVANT la route app.get('/api/feux/:id')

// Obtenir la liste des feux disponibles (non associés à une entreprise spécifique ou associés à 'system')
app.get('/api/feux/disponibles', isAdmin, (req, res) => {
  const exclusionEntreprise = req.query.exclude || '';
  console.log(`DEBUG: Récupération des feux disponibles, exclusion: ${exclusionEntreprise}`);
  
  // Requête flexible qui récupère tous les feux sauf ceux de l'entreprise à exclure
  let sql;
  let params = [];
  
  // Première tentative: chercher des feux avec IDE = 'system' ou null
  sql = "SELECT ID, Pays, Position_Géo, Position_Physique FROM FEUX WHERE (IDE = 'system' OR IDE IS NULL)";
  
  if (exclusionEntreprise && exclusionEntreprise !== '') {
    sql += " AND IDE != ?";
    params.push(exclusionEntreprise);
  }
  
  console.log(`DEBUG: SQL pour feux disponibles (première tentative): ${sql}`);
  console.log(`DEBUG: Paramètres: ${params.join(', ')}`);
  
  db.query(sql, params, (err, rows) => {
    if (err) {
      console.error("Erreur lors de la récupération des feux disponibles:", err);
      return res.status(500).json({ error: "Erreur serveur" });
    }
    
    console.log(`DEBUG: ${rows.length} feux disponibles trouvés`);
    
    // Si aucun feu disponible avec IDE = 'system', essayer tous les feux sauf ceux de l'entreprise exclue
    if (rows.length === 0) {
      console.log("DEBUG: Aucun feu 'system' trouvé, recherche de tous les feux disponibles");
      
      let fallbackSql = "SELECT ID, Pays, Position_Géo, Position_Physique FROM FEUX";
      let fallbackParams = [];
      
      if (exclusionEntreprise && exclusionEntreprise !== '') {
        fallbackSql += " WHERE IDE != ?";
        fallbackParams.push(exclusionEntreprise);
      }
      
      console.log(`DEBUG: SQL fallback: ${fallbackSql}`);
      
      db.query(fallbackSql, fallbackParams, (err, fallbackRows) => {
        if (err) {
          console.error("Erreur lors de la récupération de tous les feux:", err);
          return res.status(500).json({ error: "Erreur serveur" });
        }
        
        console.log(`DEBUG: ${fallbackRows.length} feux trouvés (en mode fallback)`);
        res.json(fallbackRows);
      });
    } else {
      res.json(rows);
    }
  });
});

// Route pour récupérer les détails d'un feu spécifique
app.get('/api/feux/:id', (req, res) => {
  const feuId = req.params.id;
  
  db.query("SELECT * FROM FEUX WHERE ID = ?", [feuId], (err, rows) => {
    if (err) {
      console.error(`Erreur lors de la récupération du feu ${feuId}:`, err);
      return res.status(500).json({ error: "Erreur serveur" });
    }
    
    if (rows.length === 0) {
      return res.status(404).json({ error: "Feu non trouvé" });
    }
    
    // Récupérer l'état actuel du feu
    db.query("SELECT etat_courant FROM FEUX_HISTORIQUE WHERE feu_id = ? ORDER BY date_changement DESC LIMIT 1", 
      [feuId], (err, stateResults) => {
        if (err) {
          console.error(`Erreur lors de la récupération de l'état du feu ${feuId}:`, err);
          return res.status(500).json({ error: "Erreur serveur" });
        }
        
        const feu = rows[0];
        
        // Ajouter l'état courant
        if (stateResults && stateResults.length > 0) {
          feu.etat_courant = stateResults[0].etat_courant;
        } else {
          feu.etat_courant = 0; // État par défaut
        }
        
        // Convertir la position géographique en latitude/longitude
        if (feu.Position_Géo) {
          const posGeo = feu.Position_Géo.split(',');
          if (posGeo.length === 2) {
            feu.latitude = parseFloat(posGeo[0]);
            feu.longitude = parseFloat(posGeo[1]);
          }
        }
        
        // Ajouter des propriétés supplémentaires pour compatibilité
        feu.nom = `Feu ${feu.ID}`;
        feu.type = "Tricolore";
        
        res.json(feu);
    });
  });
});

// Route de test simple pour vérifier que le serveur répond
app.get('/test', (req, res) => {
  res.json({ message: "Serveur fonctionnel!" });
});


// Socket.IO : Envoi des données initiales et gestion des commandes
io.on('connection', (socket) => {
  console.log("Un client web est connecté");
  
  // Envoyer les données initiales
  db.query("SELECT * FROM FEUX", (err, rows) => {
    if (err) {
      console.error("Erreur lors de la récupération initiale :", err);
      return;
    }
    // Ajouter des propriétés par défaut pour les champs manquants
    const feuxData = rows.map(feu => {
      const posGeo = feu.Position_Géo ? feu.Position_Géo.split(',') : [44.8378, -0.5792];
      return {
        ...feu,
        etat_courant: 0, // État par défaut
        nom: `Feu ${feu.ID}`,
        type: "Tricolore",
        dernier_changement: new Date().toISOString(),
        latitude: parseFloat(posGeo[0]),
        longitude: parseFloat(posGeo[1])
      };
    });
    socket.emit('initial_data', feuxData);
  });
  
  // Gestion des commandes envoyées depuis le client web
  socket.on('envoyer_commande', (data) => {
    console.log('Commande reçue du client web (envoyer_commande):', data);
    
    // Validation
    if (!data.feu_id || !data.commande || data.etat === undefined) {
      socket.emit('commande_erreur', { 
        error: "Paramètres manquants",
        feu_id: data.feu_id
      });
      return;
    }
    
    // Enregistrer la commande dans la base de données
    const insertSql = `
      INSERT INTO FEUX_COMMANDES 
        (feu_id, commande, etat_cible, date_envoi, utilisateur)
      VALUES (?, ?, ?, NOW(), ?)
    `;
    
    db.query(insertSql, [
      data.feu_id,
      data.commande,
      data.etat,
      data.utilisateur || 'socket_client'
    ], (err, result) => {
      if (err) {
        console.error("Erreur lors de l'enregistrement de la commande:", err);
        socket.emit('commande_erreur', { 
          error: "Erreur serveur: " + err.message,
          feu_id: data.feu_id
        });
        return;
      }
      
      const commandeId = result.insertId;
      
      // Envoi de la commande via MQTT
      const payload = JSON.stringify({
        id: data.feu_id,
        commande: data.commande,
        etat_cible: data.etat,
        commande_id: commandeId,
        timestamp: new Date().toISOString()
      });
      
      mqttClient.publish('feux/commande', payload, (err) => {
        if (err) {
          console.error("Erreur d'envoi de commande MQTT:", err);
          socket.emit('commande_erreur', { 
            error: "Erreur d'envoi de commande MQTT",
            feu_id: data.feu_id
          });
          return;
        }
        
        socket.emit('commande_envoyee', { 
          success: true, 
          commande_id: commandeId,
          message: `Commande envoyée au feu ${data.feu_id}` 
        });
      });
    });
  });
  
  // Nouvelle méthode pour le contrôle direct (format simplifié)
  socket.on('change_state', (data) => {
    console.log('Commande reçue du client web (change_state):', data);
    
    // Validation
    if (!data.id || data.newState === undefined) {
      socket.emit('command_error', { 
        error: "Paramètres manquants: id et newState sont requis",
        id: data.id
      });
      return;
    }
    
    // Enregistrer la commande dans la base de données
    const insertSql = `
      INSERT INTO FEUX_COMMANDES 
        (feu_id, commande, etat_cible, date_envoi, utilisateur)
      VALUES (?, ?, ?, NOW(), ?)
    `;
    
    db.query(insertSql, [
      data.id,
      'changeState', // Commande standard pour changer l'état
      data.newState,
      'web_client'
    ], (err, result) => {
      if (err) {
        console.error("Erreur lors de l'enregistrement de la commande:", err);
        socket.emit('command_error', { 
          error: "Erreur serveur: " + err.message,
          id: data.id
        });
        return;
      }
      
      const commandeId = result.insertId;
      
      // Envoi de la commande via MQTT
      const payload = JSON.stringify({
        id: data.id,
        action: 'changeState',
        newState: data.newState,
        commande_id: commandeId,
        timestamp: new Date().toISOString()
      });
      
      mqttClient.publish('feux/commande', payload, (err) => {
        if (err) {
          console.error("Erreur d'envoi de commande MQTT:", err);
          socket.emit('command_error', { 
            error: "Erreur d'envoi de commande MQTT",
            id: data.id
          });
          return;
        }
        
        console.log(`Commande de changement d'état envoyée pour ${data.id}: ${data.newState}`);
        // Pas d'émission immédiate, on attend la confirmation du simulateur
      });
    });
  });
});

// Gestion d'arrêt gracieux
process.on('SIGINT', () => {
  console.log("Arrêt du serveur...");
  isShuttingDown = true;
  
  // Fermer les connexions proprement
  io.close(() => {
    console.log("Socket.IO fermé");
    mqttClient.end(() => {
      console.log("Client MQTT déconnecté");
      db.end(() => {
        console.log("Connexion à la base de données fermée");
        server.close(() => {
          console.log("Serveur HTTP arrêté");
          process.exit(0);
        });
      });
    });
  });
});

app.get('/api/historique', (req, res) => {
  try {
    console.log("Requête reçue sur /api/historique avec paramètres:", req.query);
    
    const { page = 1, limit = 20, feu_id, dateDebut, dateFin } = req.query;
    const offset = (page - 1) * limit;
    
    // Construire la requête SQL avec les filtres
    let sql = `
      SELECT h.id, h.feu_id, CONCAT('Feu ', h.feu_id) as feu_nom, h.etat_precedent, h.etat_courant, h.date_changement 
      FROM FEUX_HISTORIQUE h
      WHERE 1=1
    `;
    
    const params = [];
    
    // Ajouter les filtres si présents
    if (feu_id) {
      sql += " AND h.feu_id = ?";
      params.push(feu_id);
    }
    
    if (dateDebut) {
      sql += " AND DATE(h.date_changement) >= ?";
      params.push(dateDebut);
    }
    
    if (dateFin) {
      sql += " AND DATE(h.date_changement) <= ?";
      params.push(dateFin);
    }
    
    console.log("Requête SQL count:", `SELECT COUNT(*) as total FROM (${sql}) as count_query`);
    console.log("Paramètres:", params);
    
    // Compter le nombre total d'enregistrements pour la pagination
    db.query(`SELECT COUNT(*) as total FROM (${sql}) as count_query`, params, (err, countResult) => {
      if (err) {
        console.error("Erreur lors du comptage des enregistrements d'historique:", err);
        return res.status(500).json({ error: "Erreur serveur", details: err.message });
      }
      
      console.log("Résultat du comptage:", countResult);
      const total = countResult && countResult.length > 0 ? countResult[0].total : 0;
      
      // Ajouter l'ordre et la pagination à la requête principale
      sql += " ORDER BY h.date_changement DESC LIMIT ? OFFSET ?";
      params.push(parseInt(limit), parseInt(offset));
      
      console.log("Requête SQL finale:", sql);
      console.log("Paramètres finaux:", params);
      
      // Exécuter la requête principale
      db.query(sql, params, (err, rows) => {
        if (err) {
          console.error("Erreur lors de la récupération de l'historique:", err);
          return res.status(500).json({ error: "Erreur serveur", details: err.message });
        }
        
        console.log("Nombre d'enregistrements trouvés:", rows ? rows.length : 0);
        
        res.json({
          total: total,
          page: parseInt(page),
          limit: parseInt(limit),
          historique: rows || []
        });
      });
    });
  } catch (e) {
    console.error("Erreur globale dans la route /api/historique:", e);
    res.status(500).json({ error: "Erreur serveur interne", details: e.message });
  }
});

// Démarrer le serveur
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Serveur lancé sur le port ${PORT}`);
});
// =============================================
// Routes pour la gestion des feux
// =============================================

// Obtenir la liste des feux disponibles (non associés à une entreprise spécifique ou associés à 'system')
// IMPORTANT: Cette route doit être AVANT app.get('/api/feux/:id') pour éviter l'erreur 404
app.get('/api/feux/disponibles', isAdmin, (req, res) => {
  const exclusionEntreprise = req.query.exclude || '';
  console.log(`DEBUG: Récupération des feux disponibles, exclusion: ${exclusionEntreprise}`);
  
  // Requête flexible qui récupère tous les feux sauf ceux de l'entreprise à exclure
  let sql;
  let params = [];
  
  // Première tentative: chercher des feux avec IDE = 'system' ou null
  sql = "SELECT ID, Pays, Position_Géo, Position_Physique FROM FEUX WHERE (IDE = 'system' OR IDE IS NULL)";
  
  if (exclusionEntreprise && exclusionEntreprise !== '') {
    sql += " AND IDE != ?";
    params.push(exclusionEntreprise);
  }
  
  console.log(`DEBUG: SQL pour feux disponibles (première tentative): ${sql}`);
  console.log(`DEBUG: Paramètres: ${params.join(', ')}`);
  
  db.query(sql, params, (err, rows) => {
    if (err) {
      console.error("Erreur lors de la récupération des feux disponibles:", err);
      return res.status(500).json({ error: "Erreur serveur" });
    }
    
    console.log(`DEBUG: ${rows.length} feux disponibles trouvés`);
    
    // Si aucun feu disponible avec IDE = 'system', essayer tous les feux sauf ceux de l'entreprise exclue
    if (rows.length === 0) {
      console.log("DEBUG: Aucun feu 'system' trouvé, recherche de tous les feux disponibles");
      
      let fallbackSql = "SELECT ID, Pays, Position_Géo, Position_Physique FROM FEUX";
      let fallbackParams = [];
      
      if (exclusionEntreprise && exclusionEntreprise !== '') {
        fallbackSql += " WHERE IDE != ?";
        fallbackParams.push(exclusionEntreprise);
      }
      
      console.log(`DEBUG: SQL fallback: ${fallbackSql}`);
      
      db.query(fallbackSql, fallbackParams, (err, fallbackRows) => {
        if (err) {
          console.error("Erreur lors de la récupération de tous les feux:", err);
          return res.status(500).json({ error: "Erreur serveur" });
        }
        
        console.log(`DEBUG: ${fallbackRows.length} feux trouvés (en mode fallback)`);
        res.json(fallbackRows);
      });
    } else {
      res.json(rows);
    }
  });
});

// Route générique pour tous les feux
app.get('/api/feux', (req, res) => {
  db.query("SELECT * FROM FEUX", (err, rows) => {
    if (err) {
      console.error("Erreur lors de la récupération des feux:", err);
      return res.status(500).json({ error: "Erreur serveur" });
    }
    
    const feux = rows.map(row => ({
      ID: row.ID,
      nom: `Feu ${row.ID}`
    }));
    
    res.json(feux);
  });
});

// Route pour récupérer les détails d'un feu spécifique
// IMPORTANT: Cette route doit être APRÈS app.get('/api/feux/disponibles')
app.get('/api/feux/:id', (req, res) => {
  const feuId = req.params.id;
  
  db.query("SELECT * FROM FEUX WHERE ID = ?", [feuId], (err, rows) => {
    if (err) {
      console.error(`Erreur lors de la récupération du feu ${feuId}:`, err);
      return res.status(500).json({ error: "Erreur serveur" });
    }
    
    if (rows.length === 0) {
      return res.status(404).json({ error: "Feu non trouvé" });
    }
    
    // Récupérer l'état actuel du feu
    db.query("SELECT etat_courant FROM FEUX_HISTORIQUE WHERE feu_id = ? ORDER BY date_changement DESC LIMIT 1", 
      [feuId], (err, stateResults) => {
        if (err) {
          console.error(`Erreur lors de la récupération de l'état du feu ${feuId}:`, err);
          return res.status(500).json({ error: "Erreur serveur" });
        }
        
        const feu = rows[0];
        
        // Ajouter l'état courant
        if (stateResults && stateResults.length > 0) {
          feu.etat_courant = stateResults[0].etat_courant;
        } else {
          feu.etat_courant = 0; // État par défaut
        }
        
        // Convertir la position géographique en latitude/longitude
        if (feu.Position_Géo) {
          const posGeo = feu.Position_Géo.split(',');
          if (posGeo.length === 2) {
            feu.latitude = parseFloat(posGeo[0]);
            feu.longitude = parseFloat(posGeo[1]);
          }
        }
        
        // Ajouter des propriétés supplémentaires pour compatibilité
        feu.nom = `Feu ${feu.ID}`;
        feu.type = "Tricolore";
        
        res.json(feu);
    });
  });
});

// Route pour modifier la durée d'un état
app.post('/api/feux/:id/duree', (req, res) => {
  const feuId = req.params.id;
  const { etat, duree, utilisateur } = req.body;
  
  // Validation
  if (etat === undefined || !duree) {
    return res.status(400).json({ error: "Paramètres manquants: etat et duree sont requis" });
  }
  
  // Vérifier que la durée est valide (entre 5 et 300 secondes)
  if (duree < 5 || duree > 300) {
    return res.status(400).json({ error: "La durée doit être entre 5 et 300 secondes" });
  }
  
  // Déterminer quelle colonne mettre à jour en fonction de l'état
  let colonneAModifier;
  switch(parseInt(etat)) {
    case 0:
      colonneAModifier = 'duree_rouge';
      break;
    case 1:
      colonneAModifier = 'duree_orange';
      break;
    case 2:
      colonneAModifier = 'duree_vert';
      break;
    default:
      return res.status(400).json({ error: "État invalide" });
  }
  
  // Récupérer l'ancienne durée
  db.query(`SELECT ${colonneAModifier} as ancienne_duree FROM FEUX WHERE ID = ?`, [feuId], (err, results) => {
    if (err) {
      console.error("Erreur lors de la récupération de l'ancienne durée:", err);
      return res.status(500).json({ error: "Erreur serveur" });
    }
    
    const ancienneDuree = results[0] ? results[0].ancienne_duree : null;
    
    // Mettre à jour la durée
    db.query(`UPDATE FEUX SET ${colonneAModifier} = ? WHERE ID = ?`, [duree, feuId], (err) => {
      if (err) {
        console.error("Erreur lors de la mise à jour de la durée:", err);
        return res.status(500).json({ error: "Erreur serveur" });
      }
      
      // Enregistrer dans l'historique
      db.query(`INSERT INTO FEUX_DUREES_HISTORIQUE (feu_id, etat, ancienne_duree, nouvelle_duree, date_changement, utilisateur) 
                VALUES (?, ?, ?, ?, NOW(), ?)`, 
        [feuId, etat, ancienneDuree, duree, utilisateur || 'system'], (err) => {
          if (err) {
            console.error("Erreur lors de l'enregistrement dans l'historique:", err);
          }
          
          // Envoyer la commande via MQTT
          const payload = JSON.stringify({
            id: feuId,
            commande: 'changerDuree',
            etat: etat,
            duree: duree,
            timestamp: new Date().toISOString()
          });
          
          mqttClient.publish('feux/commande', payload);
          
          // Notifier via Socket.IO
          io.emit('duree_modifiee', {
            id: feuId,
            etat: etat,
            duree: duree,
            message: `Durée de l'état ${etat} modifiée à ${duree}s`
          });
          
          res.json({ 
            success: true, 
            message: `Durée modifiée avec succès` 
          });
        });
    });
  });
});

// Route pour récupérer les durées actuelles d'un feu
app.get('/api/feux/:id/durees', (req, res) => {
  const feuId = req.params.id;
  
  db.query(
    'SELECT duree_rouge, duree_orange, duree_vert FROM FEUX WHERE ID = ?', 
    [feuId], 
    (err, results) => {
      if (err) {
        console.error("Erreur lors de la récupération des durées:", err);
        return res.status(500).json({ error: "Erreur serveur" });
      }
      
      if (results.length === 0) {
        return res.status(404).json({ error: "Feu non trouvé" });
      }
      
      res.json({
        duree_rouge: results[0].duree_rouge,
        duree_orange: results[0].duree_orange,
        duree_vert: results[0].duree_vert
      });
    }
  );
});

// Route API pour récupérer l'historique des commandes d'un feu
app.get('/api/feux/:id/commandes', (req, res) => {
  const feuId = req.params.id;
  const { limit = 20 } = req.query;
  
  const sql = `
    SELECT * FROM FEUX_COMMANDES 
    WHERE feu_id = ? 
    ORDER BY date_envoi DESC 
    LIMIT ?
  `;
  
  db.query(sql, [feuId, parseInt(limit)], (err, rows) => {
    if (err) {
      console.error(`Erreur lors de la récupération des commandes du feu ${feuId}:`, err);
      return res.status(500).json({ error: "Erreur serveur" });
    }
    
    res.json(rows);
  });
});

// Route API pour envoyer des commandes aux feux
app.post('/api/feux/:id/commande', (req, res) => {
  // Vérifier si le serveur est en cours d'arrêt
  if (isShuttingDown) {
    return res.status(503).json({ error: "Le serveur est en cours d'arrêt" });
  }
  
  try {
    const feuId = req.params.id;
    const { commande, etat, utilisateur } = req.body;
    
    console.log("Détails de la requête:", {
      feuId,
      commande,
      etat,
      utilisateur,
      body: req.body
    });
    
    if (!commande || etat === undefined) {
      return res.status(400).json({ error: "Paramètres manquants: commande et etat sont requis" });
    }
    
    console.log(`Commande reçue pour le feu ${feuId}: ${commande}, nouvel état: ${etat}`);
    
    // D'abord, vérifier si le feu existe dans la base de données
    db.query("SELECT ID FROM FEUX WHERE ID = ?", [feuId], (err, results) => {
      if (err) {
        console.error("Erreur lors de la vérification de l'existence du feu:", err);
        return res.status(500).json({ error: "Erreur serveur: " + err.message });
      }
      
      // Si le feu n'existe pas, on crée une entrée factice
      if (results.length === 0) {
        console.log(`Le feu ${feuId} n'existe pas dans la base de données, création d'une entrée temporaire`);
        
        // Vous pourriez choisir d'envoyer directement la commande sans créer d'entrée
        // Dans ce cas, retire ce bloc et passe directement à l'insertion de la commande
      }
      
      // Enregistrer la commande dans la base de données
      const insertSql = `
        INSERT INTO FEUX_COMMANDES 
          (feu_id, commande, etat_cible, date_envoi, utilisateur)
        VALUES (?, ?, ?, NOW(), ?)
      `;
      
      db.query(insertSql, [
        feuId,
        commande,
        etat,
        utilisateur || 'system'
      ], (err, result) => {
        if (err) {
          console.error("Erreur lors de l'enregistrement de la commande:", err);
          return res.status(500).json({ error: "Erreur serveur: " + err.message });
        }
        
        const commandeId = result.insertId;
        console.log(`Commande enregistrée avec ID: ${commandeId}`);
        
        // Envoi de la commande via MQTT
        const payload = JSON.stringify({
          id: feuId,
          commande: commande,
          etat_cible: etat,
          commande_id: commandeId,
          timestamp: new Date().toISOString()
        });
        
        mqttClient.publish('feux/commande', payload, (err) => {
          if (err) {
            console.error("Erreur d'envoi de commande MQTT:", err);
            return res.status(500).json({ error: "Erreur d'envoi de commande" });
          }
          
          console.log(`Commande MQTT publiée avec succès pour ${feuId}`);
          res.json({ 
            success: true, 
            commande_id: commandeId,
            message: `Commande envoyée au feu ${feuId}` 
          });
        });
      });
    });
  } catch (error) {
    console.error("Erreur globale dans la route des commandes:", error);
    res.status(500).json({ error: "Erreur serveur interne" });
  }
});

// =============================================
// Routes pour la gestion des entreprises (admin)
// =============================================

// Middleware de vérification d'admin
function isAdmin(req, res, next) {
  console.log("DEBUG isAdmin: Vérification des droits admin");
  const utilisateur = req.query.utilisateur || req.body.utilisateur;
  
  if (!utilisateur) {
    console.log("DEBUG isAdmin: Pas d'utilisateur, retour 401");
    return res.status(401).json({ error: "Authentification requise" });
  }
  
  // Cas spécial pour l'utilisateur 'admin' (bypass pour faciliter les tests)
  if (utilisateur === 'admin') {
    console.log("DEBUG isAdmin: Utilisateur admin, autorisation directe");
    return next();
  }
  
  db.query("SELECT Role FROM Entreprise WHERE ID = ?", [utilisateur], (err, results) => {
    if (err) {
      console.log("DEBUG isAdmin: Erreur DB:", err);
      return res.status(500).json({ error: "Erreur serveur" });
    }
    
    if (results.length === 0) {
      console.log("DEBUG isAdmin: Utilisateur non trouvé");
      return res.status(401).json({ error: "Utilisateur non trouvé" });
    }
    
    const role = results[0].Role;
    console.log(`DEBUG isAdmin: Rôle de l'utilisateur ${utilisateur}: ${role}`);
    
    if (role !== 'admin') {
      console.log("DEBUG isAdmin: Pas administrateur, retour 403");
      return res.status(403).json({ error: "Accès non autorisé. Droits d'administrateur requis." });
    }
    
    console.log("DEBUG isAdmin: Vérification réussie, autorisation accordée");
    next();
  });
}

// Obtenir la liste des entreprises
app.get('/api/entreprises', isAdmin, (req, res) => {
  console.log("DEBUG: Récupération des entreprises");
  db.query("SELECT ID, email, Role FROM Entreprise", (err, rows) => {
    if (err) {
      console.error("Erreur lors de la récupération des entreprises:", err);
      return res.status(500).json({ error: "Erreur serveur" });
    }
    
    console.log(`DEBUG: ${rows.length} entreprises trouvées`);
    res.json(rows);
  });
});
app.get('/api/entreprises/:id/feux', isAdmin, (req, res) => {
  const entrepriseId = req.params.id;
  console.log(`DEBUG: Récupération feux pour entreprise '${entrepriseId}'`);
  
  db.query("SELECT ID, Pays, Position_Géo, Position_Physique FROM FEUX WHERE IDE = ?", 
    [entrepriseId], (err, rows) => {
      if (err) {
        console.error("Erreur SQL:", err);
        return res.status(500).json({ error: "Erreur serveur" });
      }
      
      console.log(`DEBUG: ${rows.length} feux trouvés pour '${entrepriseId}'`);
      res.json(rows);
    });
});

app.get('/api/feux/disponibles', isAdmin, (req, res) => {
  const exclusionEntreprise = req.query.exclude || '';
  
  // Requête améliorée : sélectionne TOUS les feux qui sont soit non associés (system/NULL) 
  // soit associés à n'importe quelle entreprise SAUF celle spécifiée
  const sql = `
    SELECT ID, Pays, Position_Géo, Position_Physique 
    FROM FEUX 
    WHERE IDE != ?
  `;
  
  db.query(sql, [exclusionEntreprise], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: "Erreur serveur" });
    }
    
    console.log(`${rows.length} feux disponibles pour ${exclusionEntreprise}`);
    res.json(rows);
  });
});
// Association de feux à une entreprise
app.post('/api/entreprises/:id/feux', isAdmin, (req, res) => {
  const entrepriseId = req.params.id;
  const feuxIds = req.body.feux || [];
  
  if (!feuxIds.length) {
    return res.status(400).json({ error: "Aucun feu à associer" });
  }
  
  // Vérifier l'état actuel des feux avant association
  feuxIds.forEach(feuId => {
    db.query("SELECT IDE FROM FEUX WHERE ID = ?", [feuId], (err, results) => {
      if (err) {
        console.error(`Erreur vérification feu ${feuId}:`, err);
        return;
      }
      console.log(`Feu ${feuId}: IDE initial=${results[0]?.IDE || 'non défini'}`);
    });
  });
  
  // Mise à jour individuelle pour chaque feu
  db.query("START TRANSACTION", () => {
    const updatePromises = feuxIds.map(feuId => {
      return new Promise((resolve, reject) => {
        db.query("UPDATE FEUX SET IDE = ? WHERE ID = ?", [entrepriseId, feuId], (err, result) => {
          if (err) {
            reject(err);
            return;
          }
          console.log(`Feu ${feuId}: IDE après update=${entrepriseId}`);
          resolve(result);
        });
      });
    });
    
    Promise.all(updatePromises)
      .then(() => {
        db.query("COMMIT", () => {
          res.json({ success: true, message: `${feuxIds.length} feux associés avec succès` });
        });
      })
      .catch(err => {
        db.query("ROLLBACK");
        console.error("Erreur lors de l'association des feux:", err);
        res.status(500).json({ error: "Erreur serveur" });
      });
  });
});
// Ajouter une nouvelle entreprise
app.post('/api/entreprises', isAdmin, (req, res) => {
  const { id, email, password, role } = req.body;
  console.log(`DEBUG: Ajout d'une entreprise: ${id}, ${email}, role: ${role}`);
  
  if (!id || !email || !password) {
    return res.status(400).json({ error: "Données incomplètes: ID, email et password sont requis" });
  }
  
  const sql = "INSERT INTO Entreprise (ID, email, Password, Role) VALUES (?, ?, ?, ?)";
  db.query(sql, [id, email, password, role || 'user'], (err, result) => {
    if (err) {
      console.error("Erreur lors de l'ajout de l'entreprise:", err);
      if (err.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({ error: "Cette entreprise existe déjà" });
      }
      return res.status(500).json({ error: "Erreur serveur" });
    }
    
    console.log(`DEBUG: Entreprise ${id} ajoutée avec succès`);
    res.status(201).json({ 
      success: true, 
      message: "Entreprise ajoutée avec succès",
      id: id
    });
  });
});

// Mettre à jour une entreprise
app.put('/api/entreprises/:id', isAdmin, (req, res) => {
  const entrepriseId = req.params.id;
  const { email, password, role } = req.body;
  console.log(`DEBUG: Mise à jour de l'entreprise: ${entrepriseId}`);
  
  if (!email && !password && !role) {
    return res.status(400).json({ error: "Aucune donnée à mettre à jour" });
  }
  
  // Construire la requête de mise à jour en fonction des champs fournis
  let updateFields = [];
  let updateValues = [];
  
  if (email) {
    updateFields.push("email = ?");
    updateValues.push(email);
  }
  
  if (password) {
    updateFields.push("Password = ?");
    updateValues.push(password);
  }
  
  if (role) {
    updateFields.push("Role = ?");
    updateValues.push(role);
  }
  
  updateValues.push(entrepriseId);
  
  const sql = `UPDATE Entreprise SET ${updateFields.join(", ")} WHERE ID = ?`;
  console.log(`DEBUG: SQL update: ${sql}`);
  
  db.query(sql, updateValues, (err, result) => {
    if (err) {
      console.error("Erreur lors de la mise à jour de l'entreprise:", err);
      return res.status(500).json({ error: "Erreur serveur" });
    }
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Entreprise non trouvée" });
    }
    
    console.log(`DEBUG: Entreprise ${entrepriseId} mise à jour avec succès`);
    res.json({
      success: true,
      message: "Entreprise mise à jour avec succès"
    });
  });
});

// Supprimer une entreprise
app.delete('/api/entreprises/:id', isAdmin, (req, res) => {
  const entrepriseId = req.params.id;
  console.log(`DEBUG: Suppression de l'entreprise: ${entrepriseId}`);
  
  // Vérifier si c'est l'entreprise admin (qu'on ne peut pas supprimer)
  if (entrepriseId === 'admin') {
    console.log("DEBUG: Tentative de suppression de l'admin, refusée");
    return res.status(403).json({ error: "Impossible de supprimer le compte administrateur" });
  }
  
  // Vérifier si l'entreprise a des feux associés
  db.query("SELECT COUNT(*) as count FROM FEUX WHERE IDE = ?", [entrepriseId], (err, rows) => {
    if (err) {
      console.error("Erreur lors de la vérification des feux associés:", err);
      return res.status(500).json({ error: "Erreur serveur" });
    }
    
    const count = rows[0].count;
    console.log(`DEBUG: L'entreprise ${entrepriseId} a ${count} feux associés`);
    
    if (count > 0) {
      // Réassigner les feux à 'system'
      db.query("UPDATE FEUX SET IDE = 'system' WHERE IDE = ?", [entrepriseId], (err) => {
        if (err) {
          console.error("Erreur lors de la réassignation des feux:", err);
          return res.status(500).json({ error: "Erreur serveur" });
        }
        
        console.log(`DEBUG: ${count} feux réassignés à 'system'`);
        // Procéder à la suppression de l'entreprise
        deleteEntreprise();
      });
    } else {
      // Pas de feux associés, procéder directement à la suppression
      deleteEntreprise();
    }
  });
  
  function deleteEntreprise() {
    db.query("DELETE FROM Entreprise WHERE ID = ?", [entrepriseId], (err, result) => {
      if (err) {
        console.error("Erreur lors de la suppression de l'entreprise:", err);
        return res.status(500).json({ error: "Erreur serveur" });
      }
      
      if (result.affectedRows === 0) {
        console.log(`DEBUG: Entreprise ${entrepriseId} non trouvée pour suppression`);
        return res.status(404).json({ error: "Entreprise non trouvée" });
      }
      
      console.log(`DEBUG: Entreprise ${entrepriseId} supprimée avec succès`);
      res.json({
        success: true,
        message: "Entreprise supprimée avec succès"
      });
    });
  }
});



app.delete('/api/entreprises/:id/feux/:feuId', isAdmin, (req, res) => {
  const entrepriseId = req.params.id;
  const feuId = req.params.feuId;
  
  console.log(`DEBUG: Dissociation du feu ${feuId} de ${entrepriseId}`);
  
  // Vérification avant modification
  db.query("SELECT IDE FROM FEUX WHERE ID = ?", [feuId], (err, before) => {
    console.log(`DEBUG: Avant: Feu ${feuId}, IDE=${before[0]?.IDE}`);
    
    // Attribution explicite à 'system'
    db.query("UPDATE FEUX SET IDE = 'system' WHERE ID = ?", [feuId], (err, result) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Erreur serveur" });
      }
      
      // Vérification après modification
      db.query("SELECT IDE FROM FEUX WHERE ID = ?", [feuId], (err, after) => {
        console.log(`DEBUG: Après: Feu ${feuId}, IDE=${after[0]?.IDE}`);
        
        res.json({
          success: true,
          message: `Feu ${feuId} dissocié de ${entrepriseId}`,
          updated: result.affectedRows
        });
      });
    });
  });
});
// Dissocier plusieurs feux d'une entreprise
app.delete('/api/entreprises/:id/feux', isAdmin, (req, res) => {
  const entrepriseId = req.params.id;
  const { feux } = req.body; // Liste des ID de feux à dissocier
  console.log(`DEBUG: Dissociation multiple de feux de l'entreprise ${entrepriseId}:`, feux);
  
  if (!Array.isArray(feux) || feux.length === 0) {
    return res.status(400).json({ error: "Liste de feux invalide" });
  }
  
  // Créer une chaîne de paramètres pour la requête SQL (?, ?, ?, ...)
  const placeholders = feux.map(() => '?').join(', ');
  
  db.query(`UPDATE FEUX SET IDE = 'system' WHERE ID IN (${placeholders}) AND IDE = ?`, 
    [...feux, entrepriseId], (err, result) => {
      if (err) {
        console.error("Erreur lors de la dissociation des feux:", err);
        return res.status(500).json({ error: "Erreur serveur" });
      }
      
      console.log(`DEBUG: ${result.affectedRows} feux dissociés de l'entreprise ${entrepriseId}`);
      res.json({
        success: true,
        message: `${result.affectedRows} feux dissociés de l'entreprise ${entrepriseId}`,
        updated: result.affectedRows
      });
    });
});

// Route d'initialisation pour créer des feux de test (utile pour le développement)
app.post('/api/admin/init-feux-test', isAdmin, (req, res) => {
  console.log("DEBUG: Initialisation des feux de test");
  
  // Vérifier d'abord combien de feux system existent déjà
  db.query("SELECT COUNT(*) as count FROM FEUX WHERE IDE = 'system'", (err, results) => {
    if (err) {
      console.error("Erreur lors de la vérification des feux system:", err);
      return res.status(500).json({ error: "Erreur serveur" });
    }
    
    const count = results[0].count;
    console.log(`DEBUG: ${count} feux system existent déjà`);
    
    if (count >= 3) {
      return res.json({ 
        message: `${count} feux system existent déjà, pas besoin d'en créer d'autres`, 
        count: count
      });
    }
    // Créer quelques feux de test
   const feuxTest = [
    { id: 'TestFeu001', pays: 'FR', position: 'Test Position 1' },
    { id: 'TestFeu002', pays: 'DE', position: 'Test Position 2' },
    { id: 'TestFeu003', pays: 'BE', position: 'Test Position 3' }
  ];
  
  console.log("DEBUG: Création de feux de test:", feuxTest.map(f => f.id).join(', '));
  
  // Fonction pour insérer un feu de test
  const insererFeu = (feu) => {
    return new Promise((resolve, reject) => {
      // D'abord, vérifier si ce feu existe déjà
      db.query("SELECT ID FROM FEUX WHERE ID = ?", [feu.id], (err, rows) => {
        if (err) {
          return reject(err);
        }
        
        if (rows.length > 0) {
          console.log(`DEBUG: Le feu ${feu.id} existe déjà, mise à jour vers system`);
          // Mettre à jour vers system
          db.query("UPDATE FEUX SET IDE = 'system' WHERE ID = ?", [feu.id], (err, result) => {
            if (err) {
              return reject(err);
            }
            resolve({ id: feu.id, action: 'updated' });
          });
        } else {
          console.log(`DEBUG: Création du feu de test ${feu.id}`);
          // Insérer un nouveau feu
          const sql = `
            INSERT INTO FEUX (ID, Pays, Position_Physique, IDE, 
                            Tension_service, Tension_alimentation, 
                            Luminosité, Temps, Autonomie, 
                            Mode, Num_cycle, Table_cycle,
                            Etat_optique_haut, Etat_optique_bas, Etat_optique_central)
            VALUES (?, ?, ?, 'system', 
                    '12V DC', '12V DC', 
                    '100', '0h', '48h', 
                    'Fixe', '0', '1',
                    'OK', 'OK', 'OK')
          `;
          
          db.query(sql, [feu.id, feu.pays, feu.position], (err, result) => {
            if (err) {
              return reject(err);
            }
            resolve({ id: feu.id, action: 'created' });
          });
        }
      });
    });
  };
  
  // Traiter tous les feux de test
  Promise.all(feuxTest.map(insererFeu))
    .then(results => {
      console.log("DEBUG: Résultats de l'initialisation:", results);
      
      // Compter le nombre de feux system après l'initialisation
      db.query("SELECT COUNT(*) as count FROM FEUX WHERE IDE = 'system'", (err, finalCount) => {
        if (err) {
          console.error("Erreur lors du comptage final:", err);
          return res.status(500).json({ error: "Erreur serveur" });
        }
        
        const finalSystemCount = finalCount[0].count;
        console.log(`DEBUG: Nombre final de feux system: ${finalSystemCount}`);
        
        res.json({
          success: true,
          message: `Feux de test initialisés. Il y a maintenant ${finalSystemCount} feux system.`,
          results: results,
          count: finalSystemCount
        });
      });
    })
    .catch(err => {
      console.error("Erreur lors de l'initialisation des feux de test:", err);
      res.status(500).json({ error: "Erreur serveur", details: err.message });
    });
});
});

// =============================================
// Routes supplémentaires et utilitaires
// =============================================

// Route pour s'assurer que l'entreprise 'system' existe
app.post('/api/admin/ensure-system-enterprise', isAdmin, (req, res) => {
console.log("DEBUG: Vérification de l'existence de l'entreprise 'system'");

db.query("SELECT ID FROM Entreprise WHERE ID = 'system'", (err, results) => {
  if (err) {
    console.error("Erreur lors de la vérification de l'entreprise system:", err);
    return res.status(500).json({ error: "Erreur serveur" });
  }
  
  if (results.length === 0) {
    // L'entreprise 'system' n'existe pas, on la crée
    const sql = "INSERT INTO Entreprise (ID, email, Password, Role) VALUES ('system', 'system@example.com', 'systempass', 'system')";
    db.query(sql, (err, result) => {
      if (err) {
        console.error("Erreur lors de la création de l'entreprise system:", err);
        return res.status(500).json({ error: "Erreur serveur" });
      }
      
      console.log("DEBUG: Entreprise 'system' créée avec succès");
      res.json({
        success: true,
        message: "Entreprise 'system' créée avec succès",
        created: true
      });
    });
  } else {
    console.log("DEBUG: L'entreprise 'system' existe déjà");
    res.json({
      success: true,
      message: "L'entreprise 'system' existe déjà",
      created: false
    });
  }
});
});



// =============================================
// Route utilitaire d'historique
// =============================================

app.get('/api/historique', (req, res) => {
try {
  console.log("Requête reçue sur /api/historique avec paramètres:", req.query);
  
  const { page = 1, limit = 20, feu_id, dateDebut, dateFin } = req.query;
  const offset = (page - 1) * limit;
  
  // Construire la requête SQL avec les filtres
  let sql = `
    SELECT h.id, h.feu_id, CONCAT('Feu ', h.feu_id) as feu_nom, h.etat_precedent, h.etat_courant, h.date_changement 
    FROM FEUX_HISTORIQUE h
    WHERE 1=1
  `;
  
  const params = [];
  
  // Ajouter les filtres si présents
  if (feu_id) {
    sql += " AND h.feu_id = ?";
    params.push(feu_id);
  }
  
  if (dateDebut) {
    sql += " AND DATE(h.date_changement) >= ?";
    params.push(dateDebut);
  }
  
  if (dateFin) {
    sql += " AND DATE(h.date_changement) <= ?";
    params.push(dateFin);
  }
  
  console.log("Requête SQL count:", `SELECT COUNT(*) as total FROM (${sql}) as count_query`);
  console.log("Paramètres:", params);
  
  // Compter le nombre total d'enregistrements pour la pagination
  db.query(`SELECT COUNT(*) as total FROM (${sql}) as count_query`, params, (err, countResult) => {
    if (err) {
      console.error("Erreur lors du comptage des enregistrements d'historique:", err);
      return res.status(500).json({ error: "Erreur serveur", details: err.message });
    }
    
    console.log("Résultat du comptage:", countResult);
    const total = countResult && countResult.length > 0 ? countResult[0].total : 0;
    
    // Ajouter l'ordre et la pagination à la requête principale
    sql += " ORDER BY h.date_changement DESC LIMIT ? OFFSET ?";
    params.push(parseInt(limit), parseInt(offset));
    
    console.log("Requête SQL finale:", sql);
    console.log("Paramètres finaux:", params);
    
    // Exécuter la requête principale
    db.query(sql, params, (err, rows) => {
      if (err) {
        console.error("Erreur lors de la récupération de l'historique:", err);
        return res.status(500).json({ error: "Erreur serveur", details: err.message });
      }
      
      console.log("Nombre d'enregistrements trouvés:", rows ? rows.length : 0);
      
      res.json({
        total: total,
        page: parseInt(page),
        limit: parseInt(limit),
        historique: rows || []
      });
    });
  });
} catch (e) {
  console.error("Erreur globale dans la route /api/historique:", e);
  res.status(500).json({ error: "Erreur serveur interne", details: e.message });
}
});
    