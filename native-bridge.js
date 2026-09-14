// ════════════════════════════════════════════════════════════════════
// IN THE VOID — shared native (Capacitor/Android) bridge.
// Included on every page (index.html, 2.html, app/index.html,
// admin-manager.html, admin-videos.html, pdf-forensic-scanner.html).
//
// On the plain web site (no Capacitor) window.Capacitor is undefined
// and this entire file is a silent no-op.
//
// Responsibilities:
//   1) Hardware back button:
//        - closes an open modal/overlay first, if this page has one
//        - otherwise goes back one step in the WebView's own history
//          if there is a previous page to return to
//        - otherwise ("home" with nothing left to go back to) requires
//          pressing back twice within ~2s to actually exit the app
//   2) Push notifications: permission request, FCM token registration
//      + topic subscription, and opening the right in-app destination
//      when a notification is tapped (app open / background / closed).
// ════════════════════════════════════════════════════════════════════
(function ivNativeBridge(){
    if(!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform())) return;
    const { App, PushNotifications, FCM } = window.Capacitor.Plugins || {};

    // ── small in-page snackbar (works on every page, no extra plugin) ──
    function showSnackbar(msg){
        let el = document.getElementById('iv-exit-snackbar');
        if(!el){
            el = document.createElement('div');
            el.id = 'iv-exit-snackbar';
            el.style.cssText = 'position:fixed;left:50%;bottom:28px;transform:translateX(-50%);' +
                'background:#111827;color:#fff;padding:10px 20px;border-radius:999px;' +
                'font-size:14px;font-weight:600;z-index:999999;box-shadow:0 6px 20px rgba(0,0,0,.3);' +
                'opacity:0;transition:opacity .18s ease;pointer-events:none;font-family:inherit;';
            document.body.appendChild(el);
        }
        el.textContent = msg;
        requestAnimationFrame(()=>{ el.style.opacity = '1'; });
        clearTimeout(el._t);
        el._t = setTimeout(()=>{ el.style.opacity = '0'; }, 1800);
    }

    function closeAnyOpenOverlay(){
        try{
            if(typeof closeModal === 'function' && typeof state !== 'undefined' && state && state.modal){
                closeModal();
                return true;
            }
        }catch(_){}
        try{
            const openEl = document.querySelector('.modal-overlay, .modal-backdrop, [data-modal-open="1"]');
            if(openEl){ openEl.remove(); return true; }
        }catch(_){}
        return false;
    }

    // ── Hardware back button ──────────────────────────────────────────
    let lastBackPress = 0;
    try{
        if(App && App.addListener){
            App.addListener('backButton', function(ev){
                if(closeAnyOpenOverlay()) return;

                // A previous page in THIS WebView session to return to
                // (e.g. admin-manager.html -> back to app/index.html).
                if(ev && ev.canGoBack){
                    window.history.back();
                    return;
                }

                // Nothing left to go back to: require a second press
                // within ~2 seconds to actually exit, so a single
                // accidental tap never closes the app.
                const now = Date.now();
                if(now - lastBackPress < 2000){
                    if(App.exitApp) App.exitApp();
                    return;
                }
                lastBackPress = now;
                showSnackbar('اضغط مرة أخرى للخروج');
            });
        }
    }catch(e){ console.warn('back button wiring failed', e); }

    // ── Push notifications: permission + registration ─────────────────
    try{
        if(PushNotifications){
            PushNotifications.checkPermissions().then(function(res){
                if(res && res.receive !== 'granted'){
                    return PushNotifications.requestPermissions();
                }
                return res;
            }).then(function(res){
                if(res && res.receive === 'granted' && PushNotifications.register) PushNotifications.register();
            }).catch(function(e){ console.warn('push permission check failed', e); });

            PushNotifications.addListener('registration', function(token){
                // Every device subscribes to "all_users" so a broadcast
                // notification/admin message reaches everyone at once,
                // even with the app fully closed.
                try{
                    if(FCM && FCM.subscribeTo){
                        FCM.subscribeTo({ topic: 'all_users' }).catch(function(e){ console.warn('FCM topic subscribe failed', e); });
                    }
                }catch(e){ console.warn('subscribe to topic failed', e); }

                (async function(){
                    try{
                        if(typeof sb === 'undefined') return;
                        let user = null;
                        if(typeof getCurrentAuthUser === 'function'){
                            user = await getCurrentAuthUser().catch(()=>null);
                        }
                        if(!user){
                            const r = await sb.auth.getUser().catch(()=>null);
                            user = r && r.data ? r.data.user : null;
                        }
                        if(user && user.id){
                            await sb.from('device_push_tokens').upsert({
                                user_id: user.id, token: token.value, platform: 'android', updated_at: new Date().toISOString()
                            }, { onConflict: 'user_id,token' });
                        }
                    }catch(e){ console.warn('save push token failed', e); }
                })();
            });

            // Tapping a system notification — whether the app was open,
            // backgrounded, or fully closed — opens the relevant place
            // inside the app. The server sends { data: { url } } (see
            // supabase/functions/send-push); we honor that url when
            // present instead of always opening the generic notif center.
            PushNotifications.addListener('pushNotificationActionPerformed', function(action){
                let url = null;
                try{ url = action && action.notification && action.notification.data && action.notification.data.url; }catch(_){}

                if(!url){
                    openNotifCenterFallback();
                    return;
                }
                navigateToNotificationTarget(url);
            });
        }
    }catch(e){ console.warn('push notifications wiring failed', e); }

    function openNotifCenterFallback(){
        // If we're already on the main app page, just open the notif
        // center in place; otherwise navigate there.
        if(typeof openModal === 'function' && typeof loadNotifCenterList === 'function'){
            loadNotifCenterList().then(function(){
                if(typeof state !== 'undefined') state.notifCenterExpandedId = null;
                openModal('notif-center', {});
            }).catch(function(){});
        }else{
            const base = location.pathname.includes('/app/') ? './index.html' : './app/index.html';
            location.href = base + '?openNotifCenter=1';
        }
    }

    function navigateToNotificationTarget(url){
        // Same-document target (e.g. "app/index.html?openNotifCenter=1"
        // while we're already inside app/index.html): don't reload,
        // just open the notif center in place.
        try{
            const target = new URL(url, location.href);
            const samePage = target.pathname.replace(/\/+/g,'/') === location.pathname.replace(/\/+/g,'/');
            if(samePage && target.searchParams.get('openNotifCenter') === '1'){
                openNotifCenterFallback();
                return;
            }
            location.href = target.href;
        }catch(_){
            location.href = url;
        }
    }

    // Deep link from a system notification tap that relaunched the app
    // fresh (cold start) rather than firing the listener above while
    // already running, or from a browser push on the web/PWA build.
    try{
        const params = new URLSearchParams(location.search);
        if(params.get('openNotifCenter') === '1'){
            (function whenReady(tries){
                tries = tries || 0;
                if(typeof openModal === 'function' && typeof loadNotifCenterList === 'function'){
                    openNotifCenterFallback();
                    return;
                }
                if(tries > 100) return; // ~10s, give up quietly
                setTimeout(function(){ whenReady(tries + 1); }, 100);
            })();
        }
    }catch(_){}
})();
