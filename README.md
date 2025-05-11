# Système de Surveillance des Feux de Signalisation

Un système complet de monitoring et de contrôle des feux de signalisation en temps réel, comprenant un serveur, un simulateur et une interface web responsive.

## 📋 Table des Matières

- [Vue d'ensemble](#vue-densemble)
- [Fonctionnalités](#fonctionnalités)
- [Architecture](#architecture)
- [Prérequis](#prérequis)
- [Installation](#installation)
- [Configuration](#configuration)
- [Utilisation](#utilisation)
- [API](#api)
- [Technique](#technique)
- [Résolution des problèmes courants](#résolution-des-problèmes-courants)
- [Sécurité](#sécurité)
- [Contributions](#contributions)
- [Licence](#licence)

## 👁️ Vue d'ensemble

Ce système permet la surveillance en temps réel d'un réseau de feux de signalisation, avec une visualisation cartographique, la détection d'anomalies, et un contrôle à distance. Il est conçu pour être utilisé par les gestionnaires d'infrastructure routière et les entreprises responsables de la maintenance des feux.

## ✨ Fonctionnalités

### Interface Utilisateur
- **Tableau de bord interactif** : Visualisation en temps réel des feux sur une carte
- **Contrôle à distance** : Modification de l'état des feux et de leurs durées de cycle
- **Détection d'anomalies** : Alerte en cas de problème sur un feu
- **Historique** : Journal des changements d'état et des événements
- **Responsive** : Interface adaptée aux ordinateurs, tablettes et smartphones

### Administration
- **Gestion des utilisateurs** : Création et gestion des comptes entreprises
- **Attribution des feux** : Association des feux aux entreprises responsables
- **Journalisation** : Suivi des actions et événements système

### Serveur
- **Communication MQTT** : Communication bidirectionnelle avec les feux
- **Socket.IO** : Mise à jour en temps réel de l'interface web
- **API REST** : Endpoints pour toutes les actions et requêtes
- **Persistance** : Stockage MySQL des données et de l'historique

### Simulateur
- **Génération de feux** : Création de feux virtuels pour les tests
- **Simulation d'anomalies** : Génération aléatoire de problèmes techniques
- **Réponse aux commandes** : Simulation réaliste des réponses des feux

## 🏗️ Architecture

Le système est composé de trois composants principaux :

1. **Serveur NodeJS** (`server.js`) :
   - Serveur Express
   - Communication MQTT
   - Gestion de la base de données MySQL
   - Socket.IO pour les mises à jour en temps réel
   - API REST

2. **Simulateur** (`simulateur.js`) :
   - Génération de feux virtuels
   - Communication MQTT avec le serveur
   - Simulation d'états et d'anomalies

3. **Interface Web** :
   - Page principale (`index.html`) : Tableau de bord et contrôle
   - Page d'historique (`historique.html`) : Journal des événements
   - Page d'administration (`admin.html`) : Gestion du système

## 📋 Prérequis

- Node.js (v14 ou supérieur)
- MySQL (v5.7 ou supérieur)
- Broker MQTT (comme Mosquitto)
- Un navigateur web moderne

## 🚀 Installation

1. **Cloner le dépôt**
   ```bash
   git clone [URL_du_dépôt]
   cd [nom_du_dépôt]
   ```

2. **Installer les dépendances**
   ```bash
   npm install
   ```

3. **Créer la base de données MySQL**
   ```sql
   CREATE DATABASE prajot;
   USE prajot;
   
   CREATE TABLE FEUX (
     ID VARCHAR(50) PRIMARY KEY,
     Pays VARCHAR(50),
     Tension_service VARCHAR(50),
     Tension_alimentation VARCHAR(50),
     Luminosité INT,
     Temps VARCHAR(50),
     Autonomie VARCHAR(50),
     Mode VARCHAR(50),
     Num_cycle VARCHAR(50),
     Table_cycle VARCHAR(50),
     Etat_optique_haut VARCHAR(10),
     Etat_optique_bas VARCHAR(10),
     Etat_optique_central VARCHAR(10),
     Position_Géo VARCHAR(100),
     Position_Physique VARCHAR(100),
     Radio VARCHAR(10),
     Bluetooth VARCHAR(10),
     IDE VARCHAR(50),
     duree_rouge INT DEFAULT 30,
     duree_orange INT DEFAULT 5,
     duree_vert INT DEFAULT 30
   );
   
   CREATE TABLE FEUX_HISTORIQUE (
     id INT AUTO_INCREMENT PRIMARY KEY,
     feu_id VARCHAR(50),
     etat_precedent INT,
     etat_courant INT,
     date_changement DATETIME,
     FOREIGN KEY (feu_id) REFERENCES FEUX(ID)
   );
   
   CREATE TABLE FEUX_COMMANDES (
     id INT AUTO_INCREMENT PRIMARY KEY,
     feu_id VARCHAR(50),
     commande VARCHAR(50),
     etat_cible INT,
     date_envoi DATETIME,
     date_execution DATETIME,
     statut VARCHAR(50) DEFAULT 'envoyée',
     utilisateur VARCHAR(50),
     FOREIGN KEY (feu_id) REFERENCES FEUX(ID)
   );
   
   CREATE TABLE FEUX_DUREES_HISTORIQUE (
     id INT AUTO_INCREMENT PRIMARY KEY,
     feu_id VARCHAR(50),
     etat INT,
     ancienne_duree INT,
     nouvelle_duree INT,
     date_changement DATETIME,
     utilisateur VARCHAR(50),
     FOREIGN KEY (feu_id) REFERENCES FEUX(ID)
   );
   
   CREATE TABLE Entreprise (
     ID VARCHAR(50) PRIMARY KEY,
     email VARCHAR(100) UNIQUE,
     Password VARCHAR(100),
     Role VARCHAR(20) DEFAULT 'user'
   );
   
   -- Création de l'utilisateur admin
   INSERT INTO Entreprise (ID, email, Password, Role) VALUES ('admin', 'admin@example.com', 'admin', 'admin');
   INSERT INTO Entreprise (ID, email, Password, Role) VALUES ('system', 'system@example.com', 'systempass', 'system');
   INSERT INTO Entreprise (ID, email, Password, Role) VALUES ('CompanyA', 'companya@example.com', 'pass', 'user');
   INSERT INTO Entreprise (ID, email, Password, Role) VALUES ('CompanyB', 'companyb@example.com', 'pass', 'user');
   INSERT INTO Entreprise (ID, email, Password, Role) VALUES ('CompanyC', 'companyc@example.com', 'pass', 'user');
   ```

4. **Configurer l'application**
   - Modifiez la configuration de connexion à la base de données dans `server.js` :
   ```javascript
   const db = mysql.createConnection({
     host: 'localhost',
     user: 'root',
     password: '2003',
     database: 'prajot'
   });
   ```

5. **Démarrer le serveur MQTT (Mosquitto)**
   ```bash
   mosquitto -v
   ```

6. **Lancer le serveur et le simulateur**
   ```bash
   # Démarrer le serveur
   node server.js
   
   # Dans un autre terminal, démarrer le simulateur
   node simulateur.js
   ```

7. **Accéder à l'application**
   - Ouvrez votre navigateur et accédez à `http://localhost:3000`

## ⚙️ Configuration

### Configuration du serveur MQTT

Par défaut, le système se connecte à un broker MQTT local (`mqtt://localhost`). Pour modifier cette configuration, ajustez les paramètres dans :
- `server.js` : `const mqttClient = mqtt.connect('mqtt://localhost');`
- `simulateur.js` : `const client = mqtt.connect('mqtt://localhost');`

### Configuration de l'envoi d'emails

Pour les notifications par email, configurez les paramètres SMTP dans `server.js` :
```javascript
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'surveillancefeux@gmail.com',
    pass: 'lbtb lwnj eqzz xdmb'
  }
});
```

### Utilisateurs par défaut

Le système est préconfiguré avec les utilisateurs suivants :
- **Admin** : Utilisateur `admin` / Mot de passe `admin` (Accès complet)
- **Entreprises** : 
  - `CompanyA` / `pass`
  - `CompanyB` / `pass`
  - `CompanyC` / `pass`

## 🖥️ Utilisation

### Tableau de bord principal

1. Connectez-vous avec vos identifiants
2. La carte affiche tous les feux disponibles, colorés selon leur état actuel
3. Cliquez sur un feu pour afficher ses détails et le contrôler
4. Utilisez les boutons de contrôle pour changer l'état du feu
5. Ajustez les durées des cycles dans la section "Contrôle des durées"
6. Consultez les alertes dans la section dédiée en bas de la page

### Historique

1. Accédez à la page d'historique via le menu
2. Utilisez les filtres pour affiner les résultats (feu spécifique, plage de dates)
3. Consultez l'historique des changements d'état des feux

### Administration

1. Connectez-vous en tant qu'administrateur
2. Gérez les entreprises (ajout, modification, suppression)
3. Associez des feux à des entreprises
4. Consultez les feux par entreprise

## 🔌 API

### Routes pour les feux

- `GET /api/feux` - Liste tous les feux
- `GET /api/feux/:id` - Récupère les détails d'un feu spécifique
- `GET /api/feux/:id/durees` - Récupère les durées de cycle d'un feu
- `POST /api/feux/:id/commande` - Envoie une commande à un feu
- `POST /api/feux/:id/duree` - Modifie la durée d'un état

### Routes pour l'historique

- `GET /api/historique` - Récupère l'historique des changements d'état des feux

### Routes d'administration

- `GET /api/entreprises` - Liste toutes les entreprises
- `POST /api/entreprises` - Crée une nouvelle entreprise
- `PUT /api/entreprises/:id` - Modifie une entreprise
- `DELETE /api/entreprises/:id` - Supprime une entreprise
- `GET /api/entreprises/:id/feux` - Liste les feux associés à une entreprise
- `POST /api/entreprises/:id/feux` - Associe des feux à une entreprise
- `DELETE /api/entreprises/:id/feux/:feuId` - Dissocie un feu d'une entreprise

### Événements Socket.IO

- `update_feu` - Mis à jour d'un feu
- `feu_anomalie` - Détection d'une anomalie
- `command_confirmed` - Confirmation d'une commande
- `command_error` - Erreur lors de l'exécution d'une commande

## 🔧 Technique

### Structure des messages MQTT

Les messages publiés sur le topic `feux/etat` ont la structure suivante :
```json
{
  "id": "feu123",
  "type": "Tricolore",
  "owner": "CompanyA",
  "pays": "FR",
  "tension_service": "12V DC",
  "tension_alim": "12V DC",
  "etat_courant": 0,
  "cycles_count": 42,
  "latitude": 44.8378,
  "longitude": -0.5792,
  "tempsFonction": "120h",
  "autonomie": "48h",
  "optiqueHaut": "OK",
  "optiqueCentre": "OK",
  "optiqueBas": "OK"
}
```

Les commandes envoyées sur le topic `feux/commande` ont la structure suivante :
```json
{
  "id": "feu123",
  "commande": "changeState",
  "etat_cible": 2,
  "commande_id": 42,
  "timestamp": "2023-05-10T14:30:00.000Z"
}
```

### Détection d'anomalies

Le système détecte trois types d'anomalies :
1. **Tension anormale** : Lorsque la tension de service est de "5V"
2. **Optique défectueuse** : Lorsqu'un des états optiques est "NOK"
3. **Autonomie critique** : Lorsque l'autonomie est inférieure à 5 heures

### Types de feux supportés

- **Tricolore** : États 0 (Rouge), 1 (Orange), 2 (Vert)
- **Piéton + Cligno** : États 0 (Éteint), 1 (Jaune Cligno), 2 (Rouge Piéton), 3 (Vert Piéton)
- **Transport en commun** : États 0 (Stop), 1 (Go)

## 🔍 Résolution des problèmes courants

### Le serveur ne démarre pas

- Vérifiez que MySQL est en cours d'exécution
- Vérifiez les identifiants de connexion à la base de données
- Assurez-vous que les ports requis sont disponibles (3000 pour le serveur web)

### Le broker MQTT n'est pas accessible

- Vérifiez que Mosquitto est en cours d'exécution
- Vérifiez la configuration de connexion dans `server.js` et `simulateur.js`
- Assurez-vous que le port 1883 est ouvert

### Les feux n'apparaissent pas sur la carte

- Vérifiez que le simulateur est en cours d'exécution
- Vérifiez les connexions Socket.IO dans la console du navigateur
- Assurez-vous que la communication MQTT fonctionne correctement

### Les commandes ne sont pas exécutées

- Vérifiez que le simulateur est en cours d'exécution
- Vérifiez que les topics MQTT sont correctement configurés
- Consultez les logs dans la console du serveur

## 🔐 Sécurité

Ce système est une démonstration et n'intègre pas toutes les mesures de sécurité nécessaires pour un déploiement en production. Pour un déploiement réel, il faudrait :

- Implémenter un hachage sécurisé des mots de passe (bcrypt)
- Mettre en place des JWT pour l'authentification
- Sécuriser les communications MQTT (TLS)
- Mettre en œuvre des contrôles d'accès plus granulaires
- Utiliser HTTPS pour toutes les communications web
- Valider et assainir toutes les entrées utilisateurs

## 👥 Contributions

Les contributions sont les bienvenues ! Pour contribuer :

1. Forkez le dépôt
2. Créez une branche pour votre fonctionnalité (`git checkout -b feature/amazing-feature`)
3. Committez vos changements (`git commit -m 'Add some amazing feature'`)
4. Poussez vers la branche (`git push origin feature/amazing-feature`)
5. Ouvrez une Pull Request
