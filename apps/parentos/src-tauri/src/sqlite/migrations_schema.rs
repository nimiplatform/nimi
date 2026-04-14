pub(super) const V1_SCHEMA_SQL: &str = r#"
        -- Families
        CREATE TABLE IF NOT EXISTS families (
            familyId    TEXT PRIMARY KEY NOT NULL,
            displayName TEXT NOT NULL,
            createdAt   TEXT NOT NULL,
            updatedAt   TEXT NOT NULL
        );

        -- Children
        CREATE TABLE IF NOT EXISTS children (
            childId              TEXT PRIMARY KEY NOT NULL,
            familyId             TEXT NOT NULL REFERENCES families(familyId) ON DELETE CASCADE,
            displayName          TEXT NOT NULL,
            gender               TEXT NOT NULL,
            birthDate            TEXT NOT NULL,
            birthWeightKg        REAL,
            birthHeightCm        REAL,
            birthHeadCircCm      REAL,
            avatarPath           TEXT,
            nurtureMode          TEXT NOT NULL DEFAULT 'balanced',
            nurtureModeOverrides TEXT,
            allergies            TEXT,
            medicalNotes         TEXT,
            recorderProfiles     TEXT,
            createdAt            TEXT NOT NULL,
            updatedAt            TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_children_family ON children (familyId);
        CREATE INDEX IF NOT EXISTS idx_children_birth ON children (birthDate);

        -- Growth Measurements
        CREATE TABLE IF NOT EXISTS growth_measurements (
            measurementId TEXT PRIMARY KEY NOT NULL,
            childId       TEXT NOT NULL REFERENCES children(childId) ON DELETE CASCADE,
            typeId        TEXT NOT NULL,
            value         REAL NOT NULL,
            measuredAt    TEXT NOT NULL,
            ageMonths     INTEGER NOT NULL,
            percentile    REAL,
            source        TEXT,
            notes         TEXT,
            createdAt     TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_growth_child_type_date ON growth_measurements (childId, typeId, measuredAt);
        CREATE INDEX IF NOT EXISTS idx_growth_child_age ON growth_measurements (childId, ageMonths);

        -- Milestone Records
        CREATE TABLE IF NOT EXISTS milestone_records (
            recordId              TEXT PRIMARY KEY NOT NULL,
            childId               TEXT NOT NULL REFERENCES children(childId) ON DELETE CASCADE,
            milestoneId           TEXT NOT NULL,
            achievedAt            TEXT,
            ageMonthsWhenAchieved INTEGER,
            notes                 TEXT,
            photoPath             TEXT,
            createdAt             TEXT NOT NULL,
            updatedAt             TEXT NOT NULL,
            UNIQUE (childId, milestoneId)
        );
        CREATE INDEX IF NOT EXISTS idx_milestone_child_achieved ON milestone_records (childId, achievedAt);

        -- Reminder States
        CREATE TABLE IF NOT EXISTS reminder_states (
            stateId       TEXT PRIMARY KEY NOT NULL,
            childId       TEXT NOT NULL REFERENCES children(childId) ON DELETE CASCADE,
            ruleId        TEXT NOT NULL,
            status        TEXT NOT NULL,
            activatedAt   TEXT,
            completedAt   TEXT,
            dismissedAt   TEXT,
            dismissReason TEXT,
            repeatIndex   INTEGER NOT NULL DEFAULT 0,
            nextTriggerAt TEXT,
            snoozedUntil  TEXT,
            scheduledDate TEXT,
            notApplicable INTEGER NOT NULL DEFAULT 0,
            plannedForDate TEXT,
            surfaceRank   INTEGER,
            lastSurfacedAt TEXT,
            surfaceCount  INTEGER NOT NULL DEFAULT 0,
            notes         TEXT,
            createdAt     TEXT NOT NULL,
            updatedAt     TEXT NOT NULL,
            UNIQUE (childId, ruleId, repeatIndex)
        );
        CREATE INDEX IF NOT EXISTS idx_reminder_child_status ON reminder_states (childId, status);
        CREATE INDEX IF NOT EXISTS idx_reminder_next_trigger ON reminder_states (nextTriggerAt);
        CREATE INDEX IF NOT EXISTS idx_reminder_child_plan ON reminder_states (childId, plannedForDate, surfaceRank);
        CREATE INDEX IF NOT EXISTS idx_reminder_child_snooze ON reminder_states (childId, snoozedUntil);
        CREATE INDEX IF NOT EXISTS idx_reminder_child_schedule ON reminder_states (childId, scheduledDate);

        -- Vaccine Records
        CREATE TABLE IF NOT EXISTS vaccine_records (
            recordId        TEXT PRIMARY KEY NOT NULL,
            childId         TEXT NOT NULL REFERENCES children(childId) ON DELETE CASCADE,
            ruleId          TEXT NOT NULL,
            vaccineName     TEXT NOT NULL,
            vaccinatedAt    TEXT NOT NULL,
            ageMonths       INTEGER NOT NULL,
            batchNumber     TEXT,
            hospital        TEXT,
            adverseReaction TEXT,
            photoPath       TEXT,
            createdAt       TEXT NOT NULL,
            UNIQUE (childId, ruleId)
        );
        CREATE INDEX IF NOT EXISTS idx_vaccine_child_date ON vaccine_records (childId, vaccinatedAt);

        -- Journal Entries
        CREATE TABLE IF NOT EXISTS journal_entries (
            entryId             TEXT PRIMARY KEY NOT NULL,
            childId             TEXT NOT NULL REFERENCES children(childId) ON DELETE CASCADE,
            contentType         TEXT NOT NULL,
            textContent         TEXT,
            voicePath           TEXT,
            photoPaths          TEXT,
            recordedAt          TEXT NOT NULL,
            ageMonths           INTEGER NOT NULL,
            observationMode     TEXT,
            dimensionId         TEXT,
            selectedTags        TEXT,
            guidedAnswers       TEXT,
            observationDuration INTEGER,
            keepsake            INTEGER NOT NULL DEFAULT 0,
            recorderId          TEXT,
            createdAt           TEXT NOT NULL,
            updatedAt           TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_journal_child_recorded ON journal_entries (childId, recordedAt);
        CREATE INDEX IF NOT EXISTS idx_journal_child_age ON journal_entries (childId, ageMonths);
        CREATE INDEX IF NOT EXISTS idx_journal_child_keepsake ON journal_entries (childId, keepsake);

        -- Journal Tags
        CREATE TABLE IF NOT EXISTS journal_tags (
            tagId      TEXT PRIMARY KEY NOT NULL,
            entryId    TEXT NOT NULL REFERENCES journal_entries(entryId) ON DELETE CASCADE,
            domain     TEXT NOT NULL,
            tag        TEXT NOT NULL,
            source     TEXT NOT NULL,
            confidence REAL,
            createdAt  TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_jtag_entry ON journal_tags (entryId);
        CREATE INDEX IF NOT EXISTS idx_jtag_domain_tag ON journal_tags (domain, tag);

        -- AI Conversations
        CREATE TABLE IF NOT EXISTS ai_conversations (
            conversationId TEXT PRIMARY KEY NOT NULL,
            childId        TEXT NOT NULL REFERENCES children(childId) ON DELETE CASCADE,
            title          TEXT,
            startedAt      TEXT NOT NULL,
            lastMessageAt  TEXT NOT NULL,
            messageCount   INTEGER NOT NULL DEFAULT 0,
            createdAt      TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_aiconv_child_last ON ai_conversations (childId, lastMessageAt);

        -- AI Messages
        CREATE TABLE IF NOT EXISTS ai_messages (
            messageId       TEXT PRIMARY KEY NOT NULL,
            conversationId  TEXT NOT NULL REFERENCES ai_conversations(conversationId) ON DELETE CASCADE,
            role            TEXT NOT NULL,
            content         TEXT NOT NULL,
            contextSnapshot TEXT,
            createdAt       TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_aimsg_conv_created ON ai_messages (conversationId, createdAt);

        -- Growth Reports
        CREATE TABLE IF NOT EXISTS growth_reports (
            reportId       TEXT PRIMARY KEY NOT NULL,
            childId        TEXT NOT NULL REFERENCES children(childId) ON DELETE CASCADE,
            reportType     TEXT NOT NULL,
            periodStart    TEXT NOT NULL,
            periodEnd      TEXT NOT NULL,
            ageMonthsStart INTEGER NOT NULL,
            ageMonthsEnd   INTEGER NOT NULL,
            content        TEXT NOT NULL,
            generatedAt    TEXT NOT NULL,
            createdAt      TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_report_child_type_period ON growth_reports (childId, reportType, periodStart);

        -- App Settings
        CREATE TABLE IF NOT EXISTS app_settings (
            key       TEXT PRIMARY KEY NOT NULL,
            value     TEXT NOT NULL,
            updatedAt TEXT NOT NULL
        );

        -- Dental Records
        CREATE TABLE IF NOT EXISTS dental_records (
            recordId  TEXT PRIMARY KEY NOT NULL,
            childId   TEXT NOT NULL REFERENCES children(childId) ON DELETE CASCADE,
            eventType TEXT NOT NULL,
            toothId   TEXT,
            toothSet  TEXT,
            eventDate TEXT NOT NULL,
            ageMonths INTEGER NOT NULL,
            severity  TEXT,
            hospital  TEXT,
            notes     TEXT,
            photoPath TEXT,
            createdAt TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_dental_child_date ON dental_records (childId, eventDate);
        CREATE INDEX IF NOT EXISTS idx_dental_child_tooth ON dental_records (childId, toothId);
        CREATE INDEX IF NOT EXISTS idx_dental_child_type ON dental_records (childId, eventType);

        -- Allergy Records
        CREATE TABLE IF NOT EXISTS allergy_records (
            recordId             TEXT PRIMARY KEY NOT NULL,
            childId              TEXT NOT NULL REFERENCES children(childId) ON DELETE CASCADE,
            allergen             TEXT NOT NULL,
            category             TEXT NOT NULL,
            reactionType         TEXT,
            severity             TEXT NOT NULL,
            diagnosedAt          TEXT,
            ageMonthsAtDiagnosis INTEGER,
            status               TEXT NOT NULL,
            statusChangedAt      TEXT,
            confirmedBy          TEXT,
            notes                TEXT,
            createdAt            TEXT NOT NULL,
            updatedAt            TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_allergy_child_status ON allergy_records (childId, status);
        CREATE INDEX IF NOT EXISTS idx_allergy_child_category ON allergy_records (childId, category);

        -- Sleep Records
        CREATE TABLE IF NOT EXISTS sleep_records (
            recordId        TEXT PRIMARY KEY NOT NULL,
            childId         TEXT NOT NULL REFERENCES children(childId) ON DELETE CASCADE,
            sleepDate       TEXT NOT NULL,
            bedtime         TEXT,
            wakeTime        TEXT,
            durationMinutes INTEGER,
            napCount        INTEGER,
            napMinutes      INTEGER,
            quality         TEXT,
            ageMonths       INTEGER NOT NULL,
            notes           TEXT,
            createdAt       TEXT NOT NULL,
            UNIQUE (childId, sleepDate)
        );
        CREATE INDEX IF NOT EXISTS idx_sleep_child_age ON sleep_records (childId, ageMonths);

        -- Medical Events
        CREATE TABLE IF NOT EXISTS medical_events (
            eventId    TEXT PRIMARY KEY NOT NULL,
            childId    TEXT NOT NULL REFERENCES children(childId) ON DELETE CASCADE,
            eventType  TEXT NOT NULL,
            title      TEXT NOT NULL,
            eventDate  TEXT NOT NULL,
            endDate    TEXT,
            ageMonths  INTEGER NOT NULL,
            severity   TEXT,
            result     TEXT,
            hospital   TEXT,
            medication TEXT,
            dosage     TEXT,
            notes      TEXT,
            photoPath  TEXT,
            createdAt  TEXT NOT NULL,
            updatedAt  TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_medical_child_date ON medical_events (childId, eventDate);
        CREATE INDEX IF NOT EXISTS idx_medical_child_type ON medical_events (childId, eventType);

        -- Tanner Assessments
        CREATE TABLE IF NOT EXISTS tanner_assessments (
            assessmentId         TEXT PRIMARY KEY NOT NULL,
            childId              TEXT NOT NULL REFERENCES children(childId) ON DELETE CASCADE,
            assessedAt           TEXT NOT NULL,
            ageMonths            INTEGER NOT NULL,
            breastOrGenitalStage INTEGER,
            pubicHairStage       INTEGER,
            assessedBy           TEXT,
            notes                TEXT,
            createdAt            TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_tanner_child_date ON tanner_assessments (childId, assessedAt);

        -- Fitness Assessments
        CREATE TABLE IF NOT EXISTS fitness_assessments (
            assessmentId     TEXT PRIMARY KEY NOT NULL,
            childId          TEXT NOT NULL REFERENCES children(childId) ON DELETE CASCADE,
            assessedAt       TEXT NOT NULL,
            ageMonths        INTEGER NOT NULL,
            assessmentSource TEXT,
            run50m           REAL,
            run800m          REAL,
            run1000m         REAL,
            run50x8          REAL,
            sitAndReach      REAL,
            standingLongJump REAL,
            sitUps           INTEGER,
            pullUps          INTEGER,
            ropeSkipping     INTEGER,
            vitalCapacity    INTEGER,
            footArchStatus   TEXT,
            overallGrade     TEXT,
            notes            TEXT,
            createdAt        TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_fitness_child_date ON fitness_assessments (childId, assessedAt);

        -- Attachments
        CREATE TABLE IF NOT EXISTS attachments (
            attachmentId TEXT PRIMARY KEY NOT NULL,
            childId      TEXT NOT NULL REFERENCES children(childId) ON DELETE CASCADE,
            ownerTable   TEXT NOT NULL,
            ownerId      TEXT NOT NULL,
            filePath     TEXT NOT NULL,
            fileName     TEXT NOT NULL,
            mimeType     TEXT NOT NULL,
            caption      TEXT,
            createdAt    TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_attach_child_owner ON attachments (childId, ownerTable, ownerId);
        CREATE INDEX IF NOT EXISTS idx_attach_child_date  ON attachments (childId, createdAt);
"#;
