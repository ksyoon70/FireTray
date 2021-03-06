/* -*- Mode: js2; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */

var EXPORTED_SYMBOLS = [ "firetray" ];

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cu = Components.utils;

Cu.import("resource://gre/modules/ctypes.jsm");
Cu.import("resource://gre/modules/osfile.jsm");
Cu.import("resource://firetray/commons.js"); // first for Handler.app !
Cu.import("resource://firetray/icons.jsm");
Cu.import("resource://firetray/ctypes/linux/gobject.jsm");
// FIXME: can't subscribeLibsForClosing([appind])
// https://bugs.launchpad.net/ubuntu/+source/firefox/+bug/1393256
Cu.import("resource://firetray/ctypes/linux/"+firetray.Handler.app.widgetTk+"/appindicator.jsm");
Cu.import("resource://firetray/ctypes/linux/"+firetray.Handler.app.widgetTk+"/gdk.jsm");
Cu.import("resource://firetray/ctypes/linux/"+firetray.Handler.app.widgetTk+"/gtk.jsm");
Cu.import("resource://firetray/ctypes/linux/cairo.jsm");
Cu.import("resource://firetray/ctypes/linux/pango.jsm");
Cu.import("resource://firetray/ctypes/linux/pangocairo.jsm");
firetray.Handler.subscribeLibsForClosing([gobject, gdk, gtk, cairo, pango, pangocairo]);

let log = firetray.Logging.getLogger("firetray.AppIndicator");

if ("undefined" == typeof(firetray.StatusIcon))
  log.error("This module MUST be imported from/after FiretrayStatusIcon !");


firetray.AppIndicator = {
  initialized: false,
  callbacks: {},
  indicator: null,
  tempfile: null,
  MIN_FONT_SIZE: 4,
  
  init: function() {
    this.indicator = appind.app_indicator_new(
      FIRETRAY_APPINDICATOR_ID,
      firetray.StatusIcon.defaultAppIconName,
      appind.APP_INDICATOR_CATEGORY_COMMUNICATIONS
    );

    this.tempfile = OS.Path.join( OS.Constants.Path.tmpDir, 'thunderbird-unread.png' );

    appind.app_indicator_set_status(this.indicator,
                                    appind.APP_INDICATOR_STATUS_ACTIVE);
    appind.app_indicator_set_menu(this.indicator,
                                  firetray.PopupMenu.menu); // mandatory
    log.debug("indicator="+this.indicator);

    this.addCallbacks();

    for (let item in firetray.PopupMenu.menuItem) {
      firetray.PopupMenu.showItem(firetray.PopupMenu.menuItem[item]);
    }

    this.attachMiddleClickCallback();
    firetray.Handler.setIconTooltipDefault();

    this.initialized = true;
    return true;
  },

  shutdown: function() {
    log.debug("Disabling AppIndicator");
    gobject.g_object_unref(this.indicator);
    this.initialized = false;
    OS.File.remove(this.tempfile);
  },

  addCallbacks: function() {
    this.callbacks.connChanged = appind.ConnectionChangedCb_t(
      firetray.AppIndicator.onConnectionChanged); // void return, no sentinel
    gobject.g_signal_connect(this.indicator, "connection-changed",
                             firetray.AppIndicator.callbacks.connChanged, null);

    this.callbacks.onScroll = appind.OnScrollCb_t(
      firetray.AppIndicator.onScroll); // void return, no sentinel
    gobject.g_signal_connect(this.indicator, "scroll-event",
                             firetray.AppIndicator.callbacks.onScroll, null);

    this.callbacks.onActivate = appind.OnActivateCb_t(
      firetray.AppIndicator.onActivate); // void return, no sentinel
    gobject.g_signal_connect(this.indicator, "activate-event",
                             firetray.AppIndicator.callbacks.onActivate, null);
  },

  attachMiddleClickCallback: function() {
    let pref = firetray.Utils.prefService.getIntPref("middle_click");
    let item;
    if (pref === FIRETRAY_MIDDLE_CLICK_ACTIVATE_LAST) {
      log.debug("MiddleClick=Last");
      item = firetray.PopupMenu.menuItem.activateLast;
//      firetray.PopupMenu.showItem(firetray.PopupMenu.menuItem.activateLast);
    } else if (pref === FIRETRAY_MIDDLE_CLICK_SHOW_HIDE) {
      log.debug("MiddleClick=ShowHide");
      item = firetray.PopupMenu.menuItem.showHide;
//      firetray.PopupMenu.hideItem(firetray.PopupMenu.menuItem.showHide);
    } else {
      log.error("Unknown pref value for 'middle_click': "+pref);
      return false;
    }
    let menuItemShowHideWidget = ctypes.cast(item, gtk.GtkWidget.ptr);
    appind.app_indicator_set_secondary_activate_target(
      this.indicator, menuItemShowHideWidget);
    return true;
  },

  onConnectionChanged: function(indicator, connected, data) {
    log.debug("AppIndicator connection-changed: "+connected);
  },

  // https://bugs.kde.org/show_bug.cgi?id=340978 broken under KDE4
  onScroll: function(indicator, delta, direction, data) { // AppIndicator*, gint, GdkScrollDirection, gpointer
    log.debug("onScroll: "+direction);
    firetray.StatusIcon.onScroll(direction);
  },

  onActivate: function(indicator, directoin_x, direction_y, data) {
    log.debug("AppIndicator activate: x="+directoin_x+" y="+direction_y);
    firetray.Handler.showHideAllWindows();
  },

};  // AppIndicator

firetray.StatusIcon.initImpl =
  firetray.AppIndicator.init.bind(firetray.AppIndicator);

firetray.StatusIcon.shutdownImpl =
  firetray.AppIndicator.shutdown.bind(firetray.AppIndicator);


firetray.Handler.setIconImageDefault = function() {
  log.debug("setIconImageDefault");
  appind.app_indicator_set_icon_full(firetray.AppIndicator.indicator,
                                     firetray.StatusIcon.defaultAppIconName,
                                     firetray.Handler.app.name);
};

firetray.Handler.setIconImageBlank = function() {
  log.debug("setIconImageBlank");
  let byte_buf = gobject.guchar.array()(EMBEDDED_ICON_FILES['blank-icon'].bin);
  let loader = gdk.gdk_pixbuf_loader_new();
  if (loader != null) {
    gdk.gdk_pixbuf_loader_write(loader,byte_buf,byte_buf.length,null);
    gdk.gdk_pixbuf_loader_close(loader,null);
    let dest = gdk.gdk_pixbuf_loader_get_pixbuf(loader);
    if (dest != null) {
      gobject.g_object_ref(dest);

      gdk.gdk_pixbuf_save(dest, firetray.AppIndicator.tempfile, "png", null, null);

      gobject.g_object_unref(dest);
      gobject.g_object_unref(loader);

      appind.app_indicator_set_icon_full(
        firetray.AppIndicator.indicator,
        firetray.AppIndicator.tempfile,
        firetray.Handler.app.name);
    } else {
      gobject.g_object_unref(loader);

      firetray.Handler.setIconImageDefault();     
    }
  } else {
      firetray.Handler.setIconImageDefault();    
  }
};

firetray.Handler.setIconImageNewMail = function() {
  log.debug("setIconImageNewMail");
  appind.app_indicator_set_icon_full(
    firetray.AppIndicator.indicator,
    firetray.StatusIcon.defaultNewMailIconName,
    firetray.Handler.app.name);
};

firetray.Handler.setIconImageCustom = function(prefname) {
  let prefCustomIconPath = firetray.Utils.prefService.getCharPref(prefname);
  // Undocumented: ok to pass a *path* instead of an icon name! Otherwise we
  // should be changing the default icons (which is maybe a better
  // implementation anyway)...
  appind.app_indicator_set_icon_full(
    firetray.AppIndicator.indicator, prefCustomIconPath,
    firetray.Handler.app.name);
};

// No tooltips in AppIndicator
// https://bugs.launchpad.net/indicator-application/+bug/527458
firetray.Handler.setIconTooltip = function(toolTipStr) {
  log.debug("setIconTooltip");
  if (!firetray.AppIndicator.indicator)
    return false;
  firetray.PopupMenu.setItemLabel(firetray.PopupMenu.menuItem.tip,
                                  toolTipStr);
  return true;
};

// AppIndicator doesn't support pixbuf https://bugs.launchpad.net/bugs/812067
//
// sajan
firetray.Handler.setIconText = function(text, color) { 
    log.debug("setIconText: " + text);
    log.debug("setIconText, Temp: " + firetray.AppIndicator.tempfile);

    let dest = null;
    let pref = firetray.Utils.prefService.getIntPref("mail_notification_type");
    switch (pref) {
      case FIRETRAY_NOTIFICATION_BLANK_ICON:
        log.debug("setIconText, Name: blank-icon");
        
        let byte_buf = gobject.guchar.array()(EMBEDDED_ICON_FILES['blank-icon'].bin);
        let loader = gdk.gdk_pixbuf_loader_new();
        gdk.gdk_pixbuf_loader_write(loader,byte_buf,byte_buf.length,null);
        gdk.gdk_pixbuf_loader_close(loader,null);
        dest = gdk.gdk_pixbuf_loader_get_pixbuf(loader);
        
        if (dest != null) {
          gobject.g_object_ref(dest)
          log.debug("setIconText: Ref dest");
        }
        
        if (loader != null) {
          gobject.g_object_unref(loader)
          log.debug("setIconText: UnRef loader");
        }
        
        break;
      case FIRETRAY_NOTIFICATION_NEWMAIL_ICON:
        log.debug("setIconText, Name: " + firetray.StatusIcon.defaultNewMailIconName);
        
        let icon_theme = gtk.gtk_icon_theme_get_for_screen(gdk.gdk_screen_get_default());
        let arry = gobject.gchar.ptr.array()(2);
        arry[0] = gobject.gchar.array()(firetray.StatusIcon.defaultNewMailIconName);
        arry[1] = null;
        let icon_info = gtk.gtk_icon_theme_choose_icon(icon_theme, arry, 22, gtk.GTK_ICON_LOOKUP_FORCE_SIZE);
        dest = gdk.gdk_pixbuf_copy(gtk.gtk_icon_info_load_icon(icon_info, null));
        
       if (dest != null) {
          gobject.g_object_ref(dest);
          log.debug("setIconText: Ref dest");
        }
 
        break;
      case FIRETRAY_NOTIFICATION_CUSTOM_ICON:
        log.debug("setIconText, Name: custom-icon");
        let custom_icon = firetray.Utils.prefService.getCharPref("mail_icon_custom");
        log.debug("setIconText, Custom path: "+custom_icon);

        dest = gdk.gdk_pixbuf_new_from_file(custom_icon,null);
       
        if (dest != null) {
          gobject.g_object_ref(dest);
          log.debug("setIconText: Ref dest");
        }
 
        break;
      default:
        log.error("Unknown notification mode: "+pref);
        return;
    }
 
    if (dest == null) {
      log.error("Cannot load icon");
      return;
    }
    
    let w = gdk.gdk_pixbuf_get_width(dest);
    let h = gdk.gdk_pixbuf_get_height(dest);

    // prepare colors/alpha
/* FIXME: draw everything with cairo when dropping gtk2 support. Use
 gdk_pixbuf_get_from_surface(). */
if (firetray.Handler.app.widgetTk == "gtk2") {
    var colorMap = gdk.gdk_screen_get_system_colormap(gdk.gdk_screen_get_default());
    var visual = gdk.gdk_colormap_get_visual(colorMap);
    var visualDepth = visual.contents.depth;
    log.debug("colorMap="+colorMap+" visual="+visual+" visualDepth="+visualDepth);
}
    let fore = new gdk.GdkColor;
    fore.pixel = fore.red = fore.green = fore.blue = 0;
    let back = new gdk.GdkColor;
    back.pixel = back.red = back.green = back.blue = 0xFEFE;
    let alpha  = new gdk.GdkColor;
    alpha.pixel = alpha.red = alpha.green = alpha.blue = 0xFFFF;
    if (!fore || !alpha)
      log.warn("Undefined fore or alpha GdkColor");
    gdk.gdk_color_parse(color, fore.address());
    if(fore.red == alpha.red && fore.green == alpha.green && fore.blue == alpha.blue) {
      alpha.red=0; // make sure alpha is different from fore
    }
if (firetray.Handler.app.widgetTk == "gtk2") {
    gdk.gdk_colormap_alloc_color(colorMap, fore.address(), true, true);
    gdk.gdk_colormap_alloc_color(colorMap, back.address(), true, true);
    gdk.gdk_colormap_alloc_color(colorMap, alpha.address(), true, true);
}

    // build text rectangle
    let cr;
if (firetray.Handler.app.widgetTk == "gtk2") {
    var pm = gdk.gdk_pixmap_new(null, w, h, visualDepth);
    var pmDrawable = ctypes.cast(pm, gdk.GdkDrawable.ptr);
    cr = gdk.gdk_cairo_create(pmDrawable);
} else {
    // FIXME: gtk3 text position is incorrect.
    var surface = cairo.cairo_image_surface_create(cairo.CAIRO_FORMAT_ARGB32, w, h);
    cr = cairo.cairo_create(surface);
}

    gdk.gdk_cairo_set_source_color(cr, alpha.address());
    cairo.cairo_rectangle(cr, 0, 0, w, h);
    cairo.cairo_set_source_rgb(cr, 1, 1, 1);
    cairo.cairo_fill(cr);
   
    // build text
    let scratch = gtk.gtk_window_new(gtk.GTK_WINDOW_TOPLEVEL);
    let layout = gtk.gtk_widget_create_pango_layout(scratch, null);
    gtk.gtk_widget_destroy(scratch);
    let fnt = pango.pango_font_description_from_string("Sans 32");
    pango.pango_font_description_set_weight(fnt, pango.PANGO_WEIGHT_SEMIBOLD);
    pango.pango_layout_set_spacing(layout, 0);
    pango.pango_layout_set_font_description(layout, fnt);
    log.debug("layout="+layout);
    log.debug("text="+text);
    pango.pango_layout_set_text(layout, text,-1);
    let tw = new ctypes.int;
    let th = new ctypes.int;
    let sz;
    let border = 4;
    pango.pango_layout_get_pixel_size(layout, tw.address(), th.address());
    log.debug("tw="+tw.value+" th="+th.value);
    // fit text to the icon by decreasing font size
    while ( tw.value > (w - border) || th.value > (h - border) ) {
      sz = pango.pango_font_description_get_size(fnt);
      if (sz < firetray.AppIndicator.MIN_FONT_SIZE) {
        sz = firetray.AppIndicator.MIN_FONT_SIZE;
        break;
      }
      sz -= pango.PANGO_SCALE;
      pango.pango_font_description_set_size(fnt, sz);
      pango.pango_layout_set_font_description(layout, fnt);
      pango.pango_layout_get_pixel_size(layout, tw.address(), th.address());
    }
    log.debug("tw="+tw.value+" th="+th.value+" sz="+sz);
    pango.pango_font_description_free(fnt);
    // center text
    let px = (w-tw.value)/2;
    let py = (h-th.value)/2;
    log.debug("px="+px+" py="+py);

    // draw text on pixmap
    gdk.gdk_cairo_set_source_color(cr, fore.address());
    cairo.cairo_move_to(cr, px, py);
    pangocairo.pango_cairo_show_layout(cr, layout);
    cairo.cairo_destroy(cr);
    gobject.g_object_unref(layout);

    let buf = null;
if (firetray.Handler.app.widgetTk == "gtk2") {
    buf = gdk.gdk_pixbuf_get_from_drawable(null, pmDrawable, null, 0, 0, 0, 0, w, h);
    gobject.g_object_unref(pm);
}
else {
    buf = gdk.gdk_pixbuf_get_from_surface(surface, 0, 0, w, h);
    cairo.cairo_surface_destroy(surface);
}
    log.debug("alpha="+alpha);
    let alphaRed = gobject.guint16(alpha.red);
    let alphaRed_guchar = ctypes.cast(alphaRed, gobject.guchar);
    let alphaGreen = gobject.guint16(alpha.green);
    let alphaGreen_guchar = ctypes.cast(alphaGreen, gobject.guchar);
    let alphaBlue = gobject.guint16(alpha.blue);
    let alphaBlue_guchar = ctypes.cast(alphaBlue, gobject.guchar);
    let bufAlpha = gdk.gdk_pixbuf_add_alpha(buf, true, alphaRed_guchar, alphaGreen_guchar, alphaBlue_guchar);
    gobject.g_object_unref(buf);

    // merge the rendered text on top
    gdk.gdk_pixbuf_composite(bufAlpha,dest,0,0,w,h,0,0,1,1,gdk.GDK_INTERP_BILINEAR,255);
    gobject.g_object_unref(bufAlpha);

    // Workaround, appindicator only loads files
    gdk.gdk_pixbuf_save(dest, firetray.AppIndicator.tempfile, "png", null, null);
    
    appind.app_indicator_set_icon_full(
      firetray.AppIndicator.indicator,
      firetray.StatusIcon.defaultNewMailIconName,
      firetray.Handler.app.name);

    appind.app_indicator_set_icon_full(
      firetray.AppIndicator.indicator,
      firetray.AppIndicator.tempfile,
      firetray.Handler.app.name);

    if (dest != null) {
      gobject.g_object_unref(dest);
      log.debug("setIconText: UnRef dest");
    }
    
    return true;
};

firetray.Handler.setIconVisibility = function(visible) {
  if (!firetray.AppIndicator.indicator)
    return false;

  let status = visible ?
        appind.APP_INDICATOR_STATUS_ACTIVE :
        appind.APP_INDICATOR_STATUS_PASSIVE;
  appind.app_indicator_set_status(firetray.AppIndicator.indicator, status);
  return true;
};
