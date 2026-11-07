import React, { useState } from 'react';
import { ThemeProvider } from './context/ThemeContext.tsx';
import { AuthProvider, useAuth } from './context/AuthContext.tsx';
import { Sidebar } from './components/layout/Sidebar.tsx';
import { RightSidebar } from './components/layout/RightSidebar.tsx';
import { MobileNav } from './components/layout/MobileNav.tsx';
import { Timeline } from './components/feed/Timeline.tsx';
import { PostDetailModal } from './components/feed/PostDetailModal.tsx';
import { PostComposer } from './components/feed/PostComposer.tsx';
import { Modal } from './components/common/Modal.tsx';
import { ExploreView } from './components/explore/ExploreView.tsx';
import { NotificationsView } from './components/notifications/NotificationsView.tsx';
import { BookmarksView } from './components/bookmarks/BookmarksView.tsx';
import { MessagesView } from './components/messages/MessagesView.tsx';
import { ProfileView } from './components/profile/ProfileView.tsx';
import { SettingsView } from './components/settings/SettingsView.tsx';
import { LauncherSplash } from './components/common/LauncherSplash.tsx';
import { LoginScreen } from './components/auth/LoginScreen.tsx';
import { AdminRoute } from './components/admin/AdminRoute.tsx';
import { AdminDashboard } from './components/admin/AdminDashboard.tsx';
import { AdminSidebar } from './components/admin/AdminSidebar.tsx';
import { Post } from './types/index.ts';

interface BaseSidebarProps {
  currentTab: string;
  onSelectTab: (tab: string) => void;
}

function MainApp() {
  const { appConfig, isAdmin, adminRole } = useAuth();

  const [currentTab, setCurrentTab] = useState<string>('home');
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);
  const [targetUsername, setTargetUsername] = useState<string | null>(null);
  const [exploreQuery, setExploreQuery] = useState<string>('');
  const [isComposeOpen, setIsComposeOpen] = useState<boolean>(false);

  const isAdminTab = ['overview', 'users', 'posts', 'reports', 'audit', 'stats', 'settings'].includes(currentTab);

  const handlePostClick = (post: Post) => {
    setSelectedPostId(post.id);
  };

  const handleReplyClick = (post: Post) => {
    setSelectedPostId(post.id);
  };

  const handleUserClick = (username: string) => {
    setTargetUsername(username);
    setCurrentTab('profile');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleTagClick = (tag: string) => {
    setExploreQuery(tag);
    setCurrentTab('explore');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSearch = (query: string) => {
    setExploreQuery(query);
    setCurrentTab('explore');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleAdminLogout = () => {
    setCurrentTab('home');
  };

  if (isAdminTab) {
    return (
      <div className="min-h-screen flex justify-center selection:bg-cyan-500/30 selection:text-white">
        <div className="flex w-full max-w-7xl justify-between">
          <AdminSidebar
            currentTab={currentTab}
            onSelectTab={setCurrentTab}
            onLogout={handleAdminLogout}
          />
          <main className="min-w-0 flex-1 min-h-screen border-r border-white/[0.08] max-w-2xl pb-20 sm:pb-4 w-full">
            <AdminRoute allowedRoles={adminRole ? [adminRole] : undefined}>
              <AdminDashboard />
            </AdminRoute>
          </main>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex justify-center selection:bg-cyan-500/30 selection:text-white">
      {/* 3-Column Responsive Container */}
      <div className="flex w-full max-w-7xl justify-between">
        {/* Left Navigation Sidebar */}
        <Sidebar
          currentTab={currentTab}
          onSelectTab={(tab) => {
            if (tab === 'profile') setTargetUsername(null);
            setCurrentTab(tab);
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
          onOpenCompose={() => setIsComposeOpen(true)}
        />

        {/* Center Main Social Feed View */}
        <main className="min-w-0 flex-1 min-h-screen border-r border-white/[0.08] max-w-2xl pb-20 sm:pb-4 w-full">
          {currentTab === 'home' && (
            <Timeline
              onPostClick={handlePostClick}
              onReplyClick={handleReplyClick}
              onUserClick={handleUserClick}
              onTagClick={handleTagClick}
            />
          )}

          {currentTab === 'explore' && (
            <ExploreView
              initialQuery={exploreQuery}
              onPostClick={handlePostClick}
              onReplyClick={handleReplyClick}
              onUserClick={handleUserClick}
              onTagClick={handleTagClick}
            />
          )}

          {currentTab === 'notifications' && (
            <NotificationsView
              onPostClick={(id) => setSelectedPostId(id)}
              onUserClick={handleUserClick}
            />
          )}

          {currentTab === 'bookmarks' && (
            <BookmarksView
              onPostClick={handlePostClick}
              onReplyClick={handleReplyClick}
              onUserClick={handleUserClick}
              onTagClick={handleTagClick}
            />
          )}

          {currentTab === 'messages' && (
            <MessagesView />
          )}

          {currentTab === 'profile' && (
            <ProfileView
              username={targetUsername || undefined}
              onBack={() => {
                setTargetUsername(null);
                setCurrentTab('home');
              }}
              onPostClick={handlePostClick}
              onReplyClick={handleReplyClick}
              onUserClick={handleUserClick}
              onTagClick={handleTagClick}
            />
          )}

          {currentTab === 'settings' && (
            <SettingsView />
          )}
        </main>

        {/* Right Sidebar Widgets */}
        <RightSidebar
          onSearch={handleSearch}
          onSelectTag={handleTagClick}
          onUserClick={handleUserClick}
        />
      </div>

      {/* Mobile Bottom Navigation */}
      <MobileNav
        currentTab={currentTab}
        onSelectTab={(tab) => {
          if (tab === 'profile') setTargetUsername(null);
          setCurrentTab(tab);
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
      />

      {/* Post Detail / Thread Modal */}
      <PostDetailModal
        postId={selectedPostId}
        onClose={() => setSelectedPostId(null)}
        onUserClick={handleUserClick}
        onTagClick={handleTagClick}
      />

      {/* Floating Compose Modal */}
      {isComposeOpen && (
        <Modal
          isOpen={isComposeOpen}
          onClose={() => setIsComposeOpen(false)}
          title="New Post"
          maxWidth="max-w-xl"
        >
          <PostComposer
            isModal={true}
            onPostCreated={() => setIsComposeOpen(false)}
            onClose={() => setIsComposeOpen(false)}
          />
        </Modal>
      )}
    </div>
  );
}

function AppShell() {
  const { isLoading, isAuthenticated, appConfig } = useAuth();

  if (isLoading) {
    return <LauncherSplash isLoading={true} appName={appConfig?.appName} />;
  }

  if (!isAuthenticated) {
    return <LoginScreen />;
  }

  return <MainApp />;
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <AppShell />
      </AuthProvider>
    </ThemeProvider>
  );
}
