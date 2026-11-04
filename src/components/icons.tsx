import type { SVGProps } from "react";
import {
  ArrowUpRight,
  Bell,
  Book,
  BookOpen,
  Calendar,
  ChartBar,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock,
  Download,
  ExternalLink,
  FileText,
  Flag,
  Gauge,
  HelpCircle,
  Image as ImageIcon,
  LayoutDashboard,
  LifeBuoy,
  ListChecks,
  Lock,
  LogOut,
  Mail,
  Menu,
  MessageCircle,
  MoreHorizontal,
  Paperclip,
  Plus,
  Search,
  Send,
  Settings,
  Shield,
  Sparkles,
  Star,
  Ticket,
  Trash2,
  TrendingUp,
  TriangleAlert,
  Upload,
  UserRound,
  Users,
  X,
} from "lucide-react";

/**
 * The design system mandates lucide-react as the icon set. The app was written
 * against a hand-rolled `IconX` vocabulary, so this module maps every legacy
 * name onto its lucide counterpart. Pages keep importing `IconTicket` etc. and
 * get real lucide glyphs, with no call-site changes.
 */
type IconProps = SVGProps<SVGSVGElement>;

/** Brand mark — deliberately custom, lucide has no equivalent. */
export function IconLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={className}
      aria-hidden="true"
      strokeWidth={3.4}
    >
      <rect x="3.5" y="3.5" width="25" height="25" rx="8.5" />
      <path d="M16 23.5v-9" />
      <path d="M16 16c0-4.2 2.9-6.9 7-6.9 0 4.2-2.9 6.9-7 6.9Z" />
      <path d="M16 19c0-3.3-2.3-5.4-5.6-5.4 0 3.3 2.3 5.4 5.6 5.4Z" />
    </svg>
  );
}

export type { IconProps };

export const IconSearch = Search;
export const IconMail = Mail;
export const IconBell = Bell;
export const IconDashboard = LayoutDashboard;
export const IconTicket = Ticket;
export const IconTasks = ListChecks;
export const IconCalendar = Calendar;
export const IconChart = ChartBar;
export const IconTeam = Users;
export const IconGear = Settings;
export const IconHelp = HelpCircle;
export const IconLogout = LogOut;
export const IconOut = ArrowUpRight;
export const IconPlus = Plus;
export const IconMenu = Menu;
export const IconClose = X;
export const IconUp = ChevronUp;
export const IconDown = ChevronDown;
export const IconLeft = ChevronLeft;
export const IconRight = ChevronRight;
export const IconUpload = Upload;
export const IconDownload = Download;
export const IconCheck = Check;
export const IconChat = MessageCircle;
export const IconDots = MoreHorizontal;
export const IconFlag = Flag;
export const IconClock = Clock;
export const IconBook = Book;
export const IconShield = Shield;
export const IconStar = Star;
export const IconAlert = TriangleAlert;
export const IconSend = Send;
export const IconLock = Lock;
export const IconArrowUpRight = ArrowUpRight;
export const IconUser = UserRound;
export const IconImage = ImageIcon;
export const IconTrash = Trash2;
export const IconPaperclip = Paperclip;
export const IconFile = FileText;
export const IconExternalLink = ExternalLink;
export const IconTrending = TrendingUp;
export const IconGauge = Gauge;
export const IconLifeBuoy = LifeBuoy;
export const IconBookOpen = BookOpen;
export const IconSparkles = Sparkles;
