import { lazy, Suspense } from "react";
import { Routes, Route } from "react-router-dom";
import ProtectedRoute from "./components/ProtectedRoute.jsx";
import UserAppShell from "./components/UserAppShell.jsx";
import DashboardPage from "./pages/DashboardPage.jsx";

// Route-level code splitting: only the dashboard (the most common landing
// page) and the small shell components above are in the main bundle.
// Everything else loads on demand, so e.g. visiting only `/login` doesn't
// download the course player, marketplace, or educator editor code.
const PlatformPage = lazy(() => import("./pages/PlatformPage.jsx"));
const LoginPage = lazy(() => import("./pages/LoginPage.jsx"));
const RegisterPage = lazy(() => import("./pages/RegisterPage.jsx"));
const BrowsePage = lazy(() => import("./pages/BrowsePage.jsx"));
const MyCoursesPage = lazy(() => import("./pages/MyCoursesPage.jsx"));
const CoursePlayerPage = lazy(() => import("./pages/CoursePlayerPage.jsx"));
const ProfilePage = lazy(() => import("./pages/ProfilePage.jsx"));
const TutorProfilePage = lazy(() => import("./pages/TutorProfilePage.jsx"));
const StaffVerificationPage = lazy(() => import("./pages/StaffVerificationPage.jsx"));
const TransactionsPage = lazy(() => import("./pages/TransactionsPage.jsx"));
const MyBookingsPage = lazy(() => import("./pages/MyBookingsPage.jsx"));
const TutoringBrowsePage = lazy(() => import("./pages/TutoringBrowsePage.jsx"));
const MarketplaceBrowsePage = lazy(() => import("./pages/MarketplaceBrowsePage.jsx"));
const MarketplaceListingPage = lazy(() => import("./pages/MarketplaceListingPage.jsx"));
const MarketplaceSellPage = lazy(() => import("./pages/MarketplaceSellPage.jsx"));
const MarketplaceOrdersPage = lazy(() => import("./pages/MarketplaceOrdersPage.jsx"));

function RouteFallback() {
  return <p className="field-hint" style={{ padding: "2rem" }}>Loading…</p>;
}

export default function App() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/platform" element={<PlatformPage />} />
        <Route path="/staff" element={<StaffVerificationPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />

        <Route element={<ProtectedRoute />}>
          <Route element={<UserAppShell />}>
            <Route path="/browse" element={<BrowsePage />} />
            <Route path="/tutor/:tutorId" element={<TutorProfilePage />} />
            <Route path="/tutoring" element={<TutoringBrowsePage />} />
            <Route path="/bookings" element={<MyBookingsPage />} />
            <Route path="/marketplace" element={<MarketplaceBrowsePage />} />
            <Route path="/marketplace/sell" element={<MarketplaceSellPage />} />
            <Route path="/marketplace/orders" element={<MarketplaceOrdersPage />} />
            <Route path="/marketplace/:listingId" element={<MarketplaceListingPage />} />
            <Route path="/my-courses" element={<MyCoursesPage />} />
            <Route path="/transactions" element={<TransactionsPage />} />
            <Route path="/learn/:courseId" element={<CoursePlayerPage />} />
            <Route path="/profile" element={<ProfilePage />} />
          </Route>
        </Route>
      </Routes>
    </Suspense>
  );
}
