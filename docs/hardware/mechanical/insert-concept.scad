// CoolLamp insert concept A — millimetres. NOT READY TO PRINT FOR PRODUCTION.
// View from the open underside; XY positions must use this same convention.
// z=0 is the insert underside, not a confirmed enclosure mounting plane.
$fn = 120;
cavity_d = 99.06;             // Owner reported
cavity_depth = 25.4;         // Owner reported; measure actual clear depth
radial_clearance = 1.0;      // Provisional, per side
insert_d = cavity_d - 2*radial_clearance;
ring_width = 4;
base_t = 2.4;
rail_width = 7;

// Study geometry only. Do not transfer these dimensions to PCB fabrication.
pcb_size = [45,35,1.6];
pcb_hole_spacing = [36,26];
boss_d = 7;
boss_h = 5;                 // Above rail surface
pilot_d = 2.5;              // Provisional screw pilot; qualify material/fastener
show_reference = true;
show_study_pcb = false; // Centred board conflicts with stem/component clearance; layout pending
stem_hole_d = 10;      // Panel hole only, NOT full hardware/wire clearance
stem_nut_max_width = 15.5; // Owner measured widest point
stem_radial_allowance = 2.25; // Provisional clearance, not measured
stem_keepout_d = stem_nut_max_width + 2*stem_radial_allowance; // 20 mm study envelope
stem_intrusion = 15;   // Owner measured below top panel
encoder_panel_hole_d = 8.3; // Proposed hole; not drilled. XY is a design variable.

// Fit pockets are DISABLED until the actual bodies and locations are measured.
// Each pocket is an open cradle. Add retention after selecting hardware.
encoder_enabled = false;
encoder_xy = [0,0];
encoder_body = [0,0,8];    // Only depth is known; includes no terminal allowance
encoder_support_z = 0;
usb_enabled = false;
usb_xy = [0,0];
usb_body = [0,0,0];
usb_support_z = 0;
mic_enabled = false;
mic_xy = [0,0];
mic_board = [0,0,0];
mic_support_z = 0;
mic_port_xy = [0,0];        // Relative to microphone board centre
mic_port_d = 0;
pocket_wall = 1.6;
pocket_slack = 0.4;         // Per side; tune using print sample

assert(insert_d > 0 && ring_width > 0);
assert(pcb_hole_spacing[0] < pcb_size[0] && pcb_hole_spacing[1] < pcb_size[1]);

module cradle(body, acoustic=false) {
    assert(body[0] > 0 && body[1] > 0 && body[2] > 0,
           "Measure body dimensions before enabling a cradle");
    if (acoustic) assert(mic_port_d > 0, "Specify microphone acoustic opening");
    difference() {
        translate([0,0,base_t/2])
            cube([body[0]+2*(pocket_slack+pocket_wall),
                  body[1]+2*(pocket_slack+pocket_wall),base_t],center=true);
        if (acoustic) translate([mic_port_xy[0],mic_port_xy[1],-0.1])
            cylinder(d=mic_port_d,h=base_t+0.2);
    }
    // Two sides left open for terminals/cable exit.
    for (side=[-1,1])
        translate([side*(body[0]/2+pocket_slack+pocket_wall/2),0,base_t+2])
            cube([pocket_wall,body[1]+2*pocket_slack,4],center=true);
}

module insert() {
    difference() {
        union() {
            difference() {
                cylinder(d=insert_d,h=base_t);
                translate([0,0,-0.1]) cylinder(d=insert_d-2*ring_width,h=base_t+0.2);
            }
            // Parallel rails leave centre open for the lamp-stem hardware.
            intersection() {
                cylinder(d=insert_d,h=base_t);
                for(y=[-pcb_hole_spacing[1]/2,pcb_hole_spacing[1]/2])
                    translate([0,y,base_t/2]) cube([insert_d,rail_width,base_t],center=true);
            }
            for(x=[-pcb_hole_spacing[0]/2,pcb_hole_spacing[0]/2])
                for(y=[-pcb_hole_spacing[1]/2,pcb_hole_spacing[1]/2])
                    translate([x,y,base_t]) cylinder(d=boss_d,h=boss_h);
        }
        for(x=[-pcb_hole_spacing[0]/2,pcb_hole_spacing[0]/2])
            for(y=[-pcb_hole_spacing[1]/2,pcb_hole_spacing[1]/2])
                translate([x,y,-0.1]) cylinder(d=pilot_d,h=base_t+boss_h+0.2);
    }
    // Enabling a cradle does not guarantee connection to the frame or clearance.
    // Review/add supporting arms once its actual location is established.
    if(encoder_enabled) translate([encoder_xy[0],encoder_xy[1],encoder_support_z]) cradle(encoder_body);
    if(usb_enabled) translate([usb_xy[0],usb_xy[1],usb_support_z]) cradle(usb_body);
    if(mic_enabled) translate([mic_xy[0],mic_xy[1],mic_support_z]) cradle(mic_board,true);
}

insert();
if(show_study_pcb) %translate([0,0,base_t+boss_h+pcb_size[2]/2]) cube(pcb_size,center=true);
if(show_reference) %difference() {
    cylinder(d=cavity_d+2,h=cavity_depth);
    translate([0,0,-0.1]) cylinder(d=cavity_d,h=cavity_depth+0.2);
}

// Conservative full-depth hardware study envelope; nut axial location is unmeasured.
// Wiring and assembly access can require more than this 20 mm diameter.
// Assumes cavity bottom at z=0; installed insert elevation remains unconfirmed.
if(show_reference) %color("orange",0.65)
    translate([0,0,cavity_depth-stem_intrusion])
        cylinder(d=stem_keepout_d,h=stem_intrusion);
