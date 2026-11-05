-- MySQL dump 10.13  Distrib 8.1.0, for Linux (x86_64)
--
-- Host: localhost    Database: petroleum
-- ------------------------------------------------------
-- Server version	8.1.0

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

--
-- Table structure for table `EXTRACTION_BATCH`
--

DROP TABLE IF EXISTS `EXTRACTION_BATCH`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `EXTRACTION_BATCH` (
  `batch_id` int NOT NULL,
  `extraction_time` timestamp NOT NULL,
  `script_version` varchar(50) NOT NULL,
  `source_id` int NOT NULL,
  PRIMARY KEY (`batch_id`),
  KEY `source_id` (`source_id`),
  CONSTRAINT `EXTRACTION_BATCH_ibfk_1` FOREIGN KEY (`source_id`) REFERENCES `SOURCE` (`source_id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `EXTRACTION_BATCH`
--

LOCK TABLES `EXTRACTION_BATCH` WRITE;
/*!40000 ALTER TABLE `EXTRACTION_BATCH` DISABLE KEYS */;
/*!40000 ALTER TABLE `EXTRACTION_BATCH` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `FLOW`
--

DROP TABLE IF EXISTS `FLOW`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `FLOW` (
  `flow_id` int NOT NULL,
  `flow_name` varchar(150) NOT NULL,
  `flow_type` varchar(50) NOT NULL,
  `compartment` varchar(100) DEFAULT NULL,
  `unit_id` int NOT NULL,
  PRIMARY KEY (`flow_id`),
  KEY `unit_id` (`unit_id`),
  CONSTRAINT `FLOW_ibfk_1` FOREIGN KEY (`unit_id`) REFERENCES `UNIT` (`unit_id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `FLOW`
--

LOCK TABLES `FLOW` WRITE;
/*!40000 ALTER TABLE `FLOW` DISABLE KEYS */;
/*!40000 ALTER TABLE `FLOW` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `LCI_EXCHANGE`
--

DROP TABLE IF EXISTS `LCI_EXCHANGE`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `LCI_EXCHANGE` (
  `exchange_id` int NOT NULL,
  `process_id` int NOT NULL,
  `flow_id` int NOT NULL,
  `direction` varchar(3) NOT NULL,
  `amount` decimal(18,6) NOT NULL,
  `unit_id` int NOT NULL,
  `reference_id` int NOT NULL,
  `batch_id` int NOT NULL,
  `is_reference` tinyint(1) NOT NULL DEFAULT '0',
  PRIMARY KEY (`exchange_id`),
  KEY `process_id` (`process_id`),
  KEY `flow_id` (`flow_id`),
  KEY `unit_id` (`unit_id`),
  KEY `reference_id` (`reference_id`),
  KEY `batch_id` (`batch_id`),
  CONSTRAINT `LCI_EXCHANGE_ibfk_1` FOREIGN KEY (`process_id`) REFERENCES `PROCESS` (`process_id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `LCI_EXCHANGE_ibfk_2` FOREIGN KEY (`flow_id`) REFERENCES `FLOW` (`flow_id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `LCI_EXCHANGE_ibfk_3` FOREIGN KEY (`unit_id`) REFERENCES `UNIT` (`unit_id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `LCI_EXCHANGE_ibfk_4` FOREIGN KEY (`reference_id`) REFERENCES `REFERENCE` (`reference_id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `LCI_EXCHANGE_ibfk_5` FOREIGN KEY (`batch_id`) REFERENCES `EXTRACTION_BATCH` (`batch_id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `LCI_EXCHANGE`
--

LOCK TABLES `LCI_EXCHANGE` WRITE;
/*!40000 ALTER TABLE `LCI_EXCHANGE` DISABLE KEYS */;
/*!40000 ALTER TABLE `LCI_EXCHANGE` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `LOCATION`
--

DROP TABLE IF EXISTS `LOCATION`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `LOCATION` (
  `location_id` int NOT NULL,
  `name` varchar(100) NOT NULL,
  `country` varchar(50) NOT NULL,
  PRIMARY KEY (`location_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `LOCATION`
--

LOCK TABLES `LOCATION` WRITE;
/*!40000 ALTER TABLE `LOCATION` DISABLE KEYS */;
/*!40000 ALTER TABLE `LOCATION` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `PROCESS`
--

DROP TABLE IF EXISTS `PROCESS`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `PROCESS` (
  `process_id` int NOT NULL,
  `process_name` varchar(150) NOT NULL,
  `domain` varchar(100) NOT NULL,
  `process_year` int DEFAULT NULL,
  `location_id` int NOT NULL,
  `reference_id` int NOT NULL,
  PRIMARY KEY (`process_id`),
  KEY `location_id` (`location_id`),
  KEY `reference_id` (`reference_id`),
  CONSTRAINT `PROCESS_ibfk_1` FOREIGN KEY (`location_id`) REFERENCES `LOCATION` (`location_id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `PROCESS_ibfk_2` FOREIGN KEY (`reference_id`) REFERENCES `REFERENCE` (`reference_id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `PROCESS`
--

LOCK TABLES `PROCESS` WRITE;
/*!40000 ALTER TABLE `PROCESS` DISABLE KEYS */;
/*!40000 ALTER TABLE `PROCESS` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `QUALITY_CHECK`
--

DROP TABLE IF EXISTS `QUALITY_CHECK`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `QUALITY_CHECK` (
  `check_id` int NOT NULL,
  `rule_name` varchar(150) NOT NULL,
  `status` varchar(50) NOT NULL,
  `exchange_id` int NOT NULL,
  PRIMARY KEY (`check_id`),
  KEY `exchange_id` (`exchange_id`),
  CONSTRAINT `QUALITY_CHECK_ibfk_1` FOREIGN KEY (`exchange_id`) REFERENCES `LCI_EXCHANGE` (`exchange_id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `QUALITY_CHECK`
--

LOCK TABLES `QUALITY_CHECK` WRITE;
/*!40000 ALTER TABLE `QUALITY_CHECK` DISABLE KEYS */;
/*!40000 ALTER TABLE `QUALITY_CHECK` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `REFERENCE`
--

DROP TABLE IF EXISTS `REFERENCE`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `REFERENCE` (
  `reference_id` int NOT NULL,
  `reference_name` varchar(255) NOT NULL,
  `reference_type` varchar(20) NOT NULL,
  `reference_url` varchar(255) DEFAULT NULL,
  `source_id` int NOT NULL,
  PRIMARY KEY (`reference_id`),
  KEY `source_id` (`source_id`),
  CONSTRAINT `REFERENCE_ibfk_1` FOREIGN KEY (`source_id`) REFERENCES `SOURCE` (`source_id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `REFERENCE`
--

LOCK TABLES `REFERENCE` WRITE;
/*!40000 ALTER TABLE `REFERENCE` DISABLE KEYS */;
/*!40000 ALTER TABLE `REFERENCE` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `REJECTED_RECORD`
--

DROP TABLE IF EXISTS `REJECTED_RECORD`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `REJECTED_RECORD` (
  `rejected_id` int NOT NULL,
  `raw_data` varchar(255) NOT NULL,
  `error_type` varchar(255) NOT NULL,
  `check_id` int NOT NULL,
  PRIMARY KEY (`rejected_id`),
  KEY `check_id` (`check_id`),
  CONSTRAINT `REJECTED_RECORD_ibfk_1` FOREIGN KEY (`check_id`) REFERENCES `QUALITY_CHECK` (`check_id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `REJECTED_RECORD`
--

LOCK TABLES `REJECTED_RECORD` WRITE;
/*!40000 ALTER TABLE `REJECTED_RECORD` DISABLE KEYS */;
/*!40000 ALTER TABLE `REJECTED_RECORD` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `SOURCE`
--

DROP TABLE IF EXISTS `SOURCE`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `SOURCE` (
  `source_id` int NOT NULL,
  `title` varchar(255) NOT NULL,
  `publisher` varchar(150) NOT NULL,
  `publish_year` int DEFAULT NULL,
  `description` varchar(255) DEFAULT NULL,
  `url` varchar(255) NOT NULL,
  PRIMARY KEY (`source_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `SOURCE`
--

LOCK TABLES `SOURCE` WRITE;
/*!40000 ALTER TABLE `SOURCE` DISABLE KEYS */;
/*!40000 ALTER TABLE `SOURCE` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `UNIT`
--

DROP TABLE IF EXISTS `UNIT`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `UNIT` (
  `unit_id` int NOT NULL,
  `symbol` varchar(20) NOT NULL,
  `quantity` varchar(50) NOT NULL,
  `to_base_factor` decimal(18,6) NOT NULL,
  PRIMARY KEY (`unit_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `UNIT`
--

LOCK TABLES `UNIT` WRITE;
/*!40000 ALTER TABLE `UNIT` DISABLE KEYS */;
/*!40000 ALTER TABLE `UNIT` ENABLE KEYS */;
UNLOCK TABLES;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-11-05 16:57:36
