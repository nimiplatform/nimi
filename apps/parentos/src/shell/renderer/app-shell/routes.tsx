import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Surface } from '@nimiplatform/kit/ui';

const TimelinePage = lazy(() => import('../features/timeline/timeline-page.js'));
const ProfilePage = lazy(() => import('../features/profile/profile-page.js'));
const HealthMetricDetailPage = lazy(() => import('../features/profile/health-metric-detail-page.js'));
const GrowthCurvePage = lazy(() => import('../features/profile/growth-curve-page.js'));
const MilestonePage = lazy(() => import('../features/profile/milestone-page.js'));
const VaccinePage = lazy(() => import('../features/profile/vaccine-page.js'));
const VisionPage = lazy(() => import('../features/profile/vision-page.js'));
const DentalPage = lazy(() => import('../features/profile/dental-page.js'));
const AllergyPage = lazy(() => import('../features/profile/allergy-page.js'));
const SleepPage = lazy(() => import('../features/profile/sleep-page.js'));
const MedicalEventsPage = lazy(() => import('../features/profile/medical-events-page.js'));
const PosturePage = lazy(() => import('../features/profile/posture-page.js'));
const TannerPage = lazy(() => import('../features/profile/tanner-page.js'));
const FitnessPage = lazy(() => import('../features/profile/fitness-page.js'));
const OutdoorPage = lazy(() => import('../features/outdoor/outdoor-page.js').then((m) => ({ default: m.OutdoorPage })));
const JournalPage = lazy(() => import('../features/journal/journal-page.js'));
const AdvisorPage = lazy(() => import('../features/advisor/advisor-page.js'));
const ReportsPage = lazy(() => import('../features/reports/reports-page.js'));
const RemindersPage = lazy(() => import('../features/reminders/reminders-page.js'));
const SettingsPage = lazy(() => import('../features/settings/settings-page.js'));
const ChildrenSettingsPage = lazy(() => import('../features/settings/children-settings-page.js'));
const NurtureModeSettingsPage = lazy(() => import('../features/settings/nurture-mode-settings-page.js'));
const ReminderSettingsPage = lazy(() => import('../features/settings/reminder-settings-page.js'));
const AiSettingsPage = lazy(() => import('../features/settings/ai-settings-page.js'));

function PageFallback() {
  return (
    <Surface tone="canvas" padding="none" className="flex h-full items-center justify-center border-0 text-[var(--nimi-text-muted)]">
      Loading...
    </Surface>
  );
}

export function AppRoutes() {
  const profileRedirect = <Navigate to="/profile" replace />;

  return (
    <Suspense fallback={<PageFallback />}>
      <Routes>
        <Route path="/timeline" element={<TimelinePage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/profile/health/:metricId" element={<HealthMetricDetailPage />} />
        <Route path="/profile/growth" element={<GrowthCurvePage />} />
        <Route path="/profile/milestones" element={<MilestonePage />} />
        <Route path="/profile/vaccines" element={<VaccinePage />} />
        <Route path="/profile/vision" element={<VisionPage />} />
        <Route path="/profile/dental" element={<DentalPage />} />
        <Route path="/profile/allergies" element={<AllergyPage />} />
        <Route path="/profile/sleep" element={<SleepPage />} />
        <Route path="/profile/medical-events" element={<MedicalEventsPage />} />
        <Route path="/profile/posture" element={<PosturePage />} />
        <Route path="/profile/tanner" element={<TannerPage />} />
        <Route path="/profile/fitness" element={<FitnessPage />} />
        <Route path="/profile/outdoor" element={<OutdoorPage />} />
        <Route path="/profile/report-upload" element={profileRedirect} />
        <Route path="/journal" element={<JournalPage />} />
        <Route path="/advisor" element={<AdvisorPage />} />
        <Route path="/reminders" element={<RemindersPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/settings/children" element={<ChildrenSettingsPage />} />
        <Route path="/settings/nurture-mode" element={<NurtureModeSettingsPage />} />
        <Route path="/settings/reminders" element={<ReminderSettingsPage />} />
        <Route path="/settings/ai" element={<AiSettingsPage />} />
        <Route path="*" element={<Navigate to="/timeline" replace />} />
      </Routes>
    </Suspense>
  );
}
