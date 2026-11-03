import React from 'react';
import { Home, Hash, Bell, Mail, Bookmark, User as UserIcon, LogIn } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.tsx';
import { useTheme } from '../../context/ThemeContext.tsx';

interface MobileNavProps {
  currentTab: string;
  onSelectTab: (tab: string) => void;
}

export const MobileNav: React.FC<MobileNavProps> = ({ currentTab, onSelectTab }) => {
  const { unreadNotificationsCount, currentUser, setIsAuthModalOpen } = useAuth();
  const { theme, accentTextClass } = useTheme();

  const navItems = [
    { id: 'home', icon: Home },
    { id: 'explore', icon: Hash },
    { id: 'notifications', icon: Bell, badge: unreadNotificationsCount > 0 ? unreadNotificationsCount : null },
    { id: 'messages', icon: Mail },
    { id: 'bookmarks', icon: Bookmark },
    { id: 'profile', icon: UserIcon },
  ];

  const bg = theme === 'dark' ? 'bg-[#080b11]/95 border-white/[0.08]' : theme === 'dim' ? 'bg-[#0f172a]/95 border-neutral-700' : 'bg-white/95 border-neutral-200';

  return (
    <nav className={`sm:hidden fixed bottom-0 left-0 right-0 z-40 border-t ${bg} backdrop-blur-md flex items-center justify-around py-2 px-1`}>
      {navItems.map((item) => {
        const Icon = item.icon;
        const isActive = currentTab === item.id;
        return (
          <button
            key={item.id}
            onClick={() => onSelectTab(item.id)}
            className="relative p-2 rounded-full cursor-pointer transition-colors"
          >
            <Icon className={`w-6 h-6 ${isActive ? 'stroke-[2.5px] ' + accentTextClass : 'text-neutral-400'}`} />
            {item.badge && (
              <span className="absolute top-1 right-1 bg-cyan-400 text-black text-[10px] font-black rounded-full w-4 h-4 flex items-center justify-center">
                {item.badge}
              </span>
            )}
          </button>
        );
      })}

      {!currentUser && (
        <button
          onClick={() => setIsAuthModalOpen(true)}
          className="relative p-2 rounded-full cursor-pointer text-cyan-400"
          title="Sign In"
        >
          <LogIn className="w-6 h-6 stroke-[2.2px]" />
        </button>
      )}
    </nav>
  );
};
