// CoolLamp shared stem/encoder mount — STUDY ONLY, dimensions in mm.
// Coordinate convention: z increases inward from inside metal top panel.
// Preview assemblies only; not a production STL or validated encoder footprint.
$fn=96;
panel_to_pcb=4.5; // Owner measurement
pcb_t=1.6; // Proposed board thickness
stem_projection=15; // Owner measurement
nut_max_width=15.5; // Owner measurement; not nut thickness
// All parameters below are proposed/unmeasured, not ordering dimensions.
stem_d=9.5;
board_hole_d=11;
spacer_od=22;
washer_od=20;
washer_t=1;
nut_t=3;
board_d=65;
encoder_xy=[0,-24];
encoder_body=[13.05,12,4.5]; // Simplified envelope, not a footprint
show_panel=true;
show_board=true;
show_encoder=true;
show_hardware=true;
// Select individual spacer geometry only for review; dimensions unqualified.
part="assembly"; // "assembly" or "spacer"
module annulus(od,id,h){difference(){cylinder(d=od,h=h);translate([0,0,-0.01])cylinder(d=id,h=h+0.02);}}
module spacer(){annulus(spacer_od,board_hole_d,panel_to_pcb);}
module assembly(){
 if(show_panel) color([0.5,0.55,0.6,0.18]) translate([0,0,-1]) difference(){
  cylinder(d=99.06,h=1);
  translate([0,0,-0.1]) cylinder(d=10,h=1.2);
  translate([encoder_xy[0],encoder_xy[1],-0.1]) cylinder(d=8.3,h=1.2);
 }
 color("ivory") spacer();
 if(show_board) color([0.05,0.5,0.35,0.75]) translate([0,0,panel_to_pcb]) annulus(board_d,board_hole_d,pcb_t);
 if(show_encoder){
  color("silver") translate([encoder_xy[0],encoder_xy[1],panel_to_pcb/2]) cube(encoder_body,center=true);
  color("gray") translate([encoder_xy[0],encoder_xy[1],-12]) cylinder(d=6,h=12);
 }
 if(show_hardware){
  color("silver") cylinder(d=stem_d,h=stem_projection);
  color("ivory") translate([0,0,panel_to_pcb+pcb_t]) annulus(washer_od,board_hole_d,washer_t);
  color("gray") translate([0,0,panel_to_pcb+pcb_t+washer_t]) difference(){
   cylinder(d=nut_max_width,h=nut_t,$fn=6);
   translate([0,0,-0.1]) cylinder(d=stem_d,h=nut_t+0.2);
  }
 }
}
if(part=="spacer") spacer(); else assembly();
// Missing: true stem bore/wire path, threads, encoder terminals/tab holes,
// component placement, antenna keepout, USB inlet and microphone mounting.
// The 65 mm disk is a layout envelope, not a selected controller PCB outline.
