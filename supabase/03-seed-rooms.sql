insert into public.rooms(id, name, capacity, equipment, is_active) values
('db5fe880-a43f-4292-b51b-05cfca000001','ห้องประสงค์ ตู้จินดา',120,array['คอมพิวเตอร์','ระบบเสียง','Projector','Visualizer','LAN','Wi-Fi'],true),
('db5fe880-a43f-4292-b51b-05cfca000002','ห้องรับรอง',15,array['ระบบเสียง','Wi-Fi'],true),
('db5fe880-a43f-4292-b51b-05cfca000003','ห้องประชุมเล็ก 2/1-2',25,array['คอมพิวเตอร์','Projector','Wi-Fi'],true),
('db5fe880-a43f-4292-b51b-05cfca000004','ห้องบรรยาย 3/1-2',60,array['คอมพิวเตอร์','ระบบเสียง','Projector','Visualizer','LAN','Wi-Fi'],true),
('db5fe880-a43f-4292-b51b-05cfca000005','ห้องประชุม 4/1-2',20,array['คอมพิวเตอร์','Projector','Wi-Fi'],true),
('db5fe880-a43f-4292-b51b-05cfca000006','ห้องบรรยาย 5/1-2',50,array['คอมพิวเตอร์','ระบบเสียง','Projector','LAN','Wi-Fi'],true),
('db5fe880-a43f-4292-b51b-05cfca000007','ห้องเฉิดฉลอง เนตรศิริ',70,array['คอมพิวเตอร์','ระบบเสียง','Projector','Visualizer','LAN','Wi-Fi'],true),
('db5fe880-a43f-4292-b51b-05cfca000008','ห้องประชุมกุมาร 5',40,array['คอมพิวเตอร์','ระบบเสียง','Projector','LAN','Wi-Fi'],true),
('db5fe880-a43f-4292-b51b-05cfca000009','ห้องประชุมชนิกา ตู้จินดา',20,array['คอมพิวเตอร์','Projector','Wi-Fi'],true)
on conflict do nothing;
