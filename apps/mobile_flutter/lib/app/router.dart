import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../design/tokens.dart';
import '../features/chat/presentation/chat_screen.dart';
import '../features/motion/presentation/motion_lab_screen.dart';
import '../features/settings/presentation/settings_screen.dart';
import 'app_scope.dart';

GoRouter createRouter() {
  return GoRouter(
    initialLocation: '/',
    routes: [
      GoRoute(
        path: '/',
        builder: (context, state) =>
            ChatScreen(controller: AppScope.maybeOf(context)?.chat),
      ),
      GoRoute(
        path: '/settings',
        pageBuilder: (context, state) {
          final services = AppScope.maybeOf(context);
          return _slidePage(
            context,
            state,
            SettingsScreen(
              cloud: services?.cloud,
              update: services?.update,
              shareImport: services?.shareImport,
              archiveImport: services?.archiveImport,
              user: services?.session.user,
              api: services?.api,
              onLogout: services == null
                  ? null
                  : () {
                      services.session.logout();
                      context.go('/');
                    },
            ),
          );
        },
      ),
      GoRoute(
        path: '/motion',
        pageBuilder: (context, state) =>
            _slidePage(context, state, const MotionLabScreen()),
      ),
    ],
  );
}

Page<void> _slidePage(BuildContext context, GoRouterState state, Widget child) {
  final reduceMotion = MediaQuery.disableAnimationsOf(context);
  return CustomTransitionPage<void>(
    key: state.pageKey,
    child: child,
    transitionDuration: reduceMotion ? Duration.zero : DreamMotion.page,
    reverseTransitionDuration: reduceMotion
        ? Duration.zero
        : DreamMotion.pageOut,
    transitionsBuilder: (context, animation, secondaryAnimation, child) {
      if (MediaQuery.disableAnimationsOf(context)) {
        return child;
      }
      final fade = CurvedAnimation(
        parent: animation,
        curve: const Interval(0, 0.72, curve: DreamMotion.standard),
        reverseCurve: DreamMotion.exit,
      );
      final slide =
          Tween<Offset>(begin: const Offset(0, 0.04), end: Offset.zero).animate(
            CurvedAnimation(
              parent: animation,
              curve: DreamMotion.standard,
              reverseCurve: DreamMotion.exit,
            ),
          );
      return FadeTransition(
        opacity: fade,
        child: SlideTransition(position: slide, child: child),
      );
    },
  );
}
