import React, { useState, Component, ErrorInfo, ReactNode } from 'react';
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
import { AuditLogView } from './components/admin/AuditLogView.tsx';
import { Post } from './types/index.ts';

interface BaseSidebarProps {
  currentTab: string;
  onSelectTab: (tab: string) => void;
}

class ErrorBoundary extends Component<{ children: ReactNode; fallback?: ReactNode }, { hasError: boolean; error: Error | null }> {
  constructor(props: { children: ReactNode; fallback?: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Application error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
      return (
        <div className="min-h-screen flex items-center justify-center bg-[#060910] text-white p-4">
          <div className="text-center max-w-md">
            <h1 className="text-2xl font-bold mb-4">Something went wrong</h1>
            <p className="text-neutral-400 mb-6">{this.state.error?.message || 'An unexpected error occurred'}</p>
            <button
              onClick={() => window.location.reload()}
              className="px-6 py-3 bg-cyan-500 text-black font-bold rounded-xl hover:bg-cyan-400 transition-colors"
            >
              Reload Page
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function MainApp() {
  const { appConfig, isAdmin, adminRole } = useAuth();

  const [currentTab, setCurrentTab] = useState<string>('home');
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);
  const [targetUsername, setTargetUsername] = useState<string | null>(null);
  const [exploreQuery, setExploreQuery] = useState<string>('');
  const [isComposeOpen, setIsComposeOpen] = useState<boolean>(false);

  const isAdminTab = ['overview', 'users', 'posts', 'reports', 'audit', 'stats'].includes(currentTab);

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
    const renderAdminContent = () => {
      switch (currentTab) {
        case 'overview':
          return <AdminDashboard />;
        case 'audit':
          return <AuditLogView />;
        case 'users':
        case 'posts':
        case 'reports':
        case 'stats':
        default:
          return (
            <div className="p-6 text-center text-neutral-500">
              <div className="text-6xl mb-4">🚧</div>
              <h2 className="text-xl font-semibold text-white mb-2">{currentTab.charAt(0).toUpperCase() + currentTab.slice(1)}</h2>
              <p>Coming soon — this section is under development.</p>
            </div>
          );
      }
    };

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
              {renderAdminContent()}
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
  const { isLoading, isAuthenticated, appConfig, currentUser } = useAuth();

  if (isLoading) {
    return <LauncherSplash isLoading={true} appName={appConfig?.appName} />;
  }

  if (!isAuthenticated || !currentUser?.id || !currentUser?.username) {
    return <LoginScreen />;
  }

  return <MainApp />;
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <ErrorBoundary>
          <AppShell />
        </ErrorBoundary>
      </AuthProvider>
    </ThemeProvider>
  );
}
